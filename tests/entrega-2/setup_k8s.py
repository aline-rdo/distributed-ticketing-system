from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
CLUSTER_NAME = "cin0143"
IMAGE_PREFIX = "docker.io/cin0143"
SERVICES = (
    "analytics-service",
    "email-service",
    "tickets-service",
    "payment-service",
    "frontend",
)


def run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    subprocess.run(command, cwd=ROOT, check=True, env=env)


def verify_tools() -> None:
    for tool in ("podman", "kind", "kubectl"):
        if not shutil.which(tool):
            raise SystemExit(f"Erro: {tool} nao encontrado no PATH.")


def kind_provider_env() -> dict[str, str]:
    return {**os.environ, "KIND_EXPERIMENTAL_PROVIDER": "podman"}


def kind_provider_nodes(cluster_name: str) -> None:
    result = subprocess.run(
        ["kind", "get", "nodes", "--name", cluster_name],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        env=kind_provider_env(),
    )
    if not result.stdout.strip():
        raise RuntimeError(
            "O cluster kind ativo nao possui nodes no provider Podman rootless."
        )


def verify_cluster() -> str:
    cluster_name = kind_cluster_name()
    kind_provider_nodes(cluster_name)
    run(["kubectl", "get", "nodes"])
    return cluster_name


def kind_cluster_name() -> str:
    result = subprocess.run(
        ["kubectl", "config", "current-context"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    context = result.stdout.strip()
    expected_context = f"kind-{CLUSTER_NAME}"
    if context != expected_context:
        raise RuntimeError(
            f"O contexto Kubernetes atual deve ser {expected_context}, mas e {context!r}. "
            f"Crie o cluster com: KIND_EXPERIMENTAL_PROVIDER=podman "
            f"kind create cluster --name {CLUSTER_NAME}"
        )
    return CLUSTER_NAME


def build_images() -> None:
    for service in SERVICES[:-1]:
        run([
            "podman",
            "build",
            "-t",
            f"{IMAGE_PREFIX}/{service}:entrega-2",
            "-f",
            f"microservices/{service}/Dockerfile",
            ".",
        ])

    run([
        "podman",
        "build",
        "-t",
        f"{IMAGE_PREFIX}/frontend:entrega-2",
        "--build-arg",
        "NEXT_PUBLIC_PAYMENT_URL=http://localhost:8000",
        "./frontend",
    ])


def load_images(archive_dir: Path, cluster_name: str) -> None:
    kind_env = kind_provider_env()
    for service in SERVICES:
        archive = archive_dir / f"{service}.tar"
        run([
            "podman",
            "save",
            "-o",
            str(archive),
            f"{IMAGE_PREFIX}/{service}:entrega-2",
        ])
        run([
            "kind",
            "load",
            "image-archive",
            str(archive),
            "--name",
            cluster_name,
        ], env=kind_env)


def apply_manifests() -> None:
    run(["kubectl", "apply", "-f", "k8s/"])
    for service in SERVICES:
        run(["kubectl", "rollout", "status", f"deployment/{service}", "--timeout=120s"])
    for resource in ("deployments", "pods", "services"):
        run(["kubectl", "get", resource])


def main() -> int:
    try:
        print("==> Verificando ferramentas necessarias...")
        verify_tools()
        print("==> Verificando cluster Kubernetes...")
        cluster_name = verify_cluster()
        print("==> Construindo imagens...")
        build_images()
        print("==> Carregando imagens no kind...")
        with tempfile.TemporaryDirectory(prefix="entrega-2-images-") as directory:
            load_images(Path(directory), cluster_name)
        print("==> Aplicando manifests Kubernetes...")
        apply_manifests()
        print("Ambiente Kubernetes preparado com sucesso.")
        return 0
    except (FileNotFoundError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Erro ao preparar o ambiente Kubernetes: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
