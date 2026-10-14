from __future__ import annotations

import importlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch


TESTS_DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIRECTORY))

setup_k8s = importlib.import_module("setup_k8s")
port_forward = importlib.import_module("port_forward")


class SetupK8sTests(unittest.TestCase):
    def test_verify_tools_stops_when_a_required_binary_is_missing(self) -> None:
        def which(name: str) -> str | None:
            return None if name == "kind" else f"/usr/bin/{name}"

        with patch.object(setup_k8s.shutil, "which", side_effect=which):
            with self.assertRaisesRegex(SystemExit, "kind"):
                setup_k8s.verify_tools()

    def test_main_builds_loads_applies_and_waits_for_all_workloads(self) -> None:
        commands: list[tuple[list[str], dict[str, str] | None]] = []

        def capture(command: list[str], *, env: dict[str, str] | None = None) -> None:
            commands.append((command, env))

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(setup_k8s, "verify_tools"), \
                    patch.object(setup_k8s, "kind_cluster_name", return_value="cin0143"), \
                    patch.object(setup_k8s, "kind_provider_nodes"), \
                    patch.object(setup_k8s, "run", side_effect=capture), \
                    patch.object(setup_k8s.tempfile, "TemporaryDirectory", return_value=_TempDir(directory)):
                self.assertEqual(setup_k8s.main(), 0)

        self.assertIn((["kubectl", "get", "nodes"], None), commands)
        self.assertIn(
            ([
                "podman", "build", "-t", "docker.io/cin0143/analytics-service:entrega-2",
                "-f", "microservices/analytics-service/Dockerfile", ".",
            ], None),
            commands,
        )
        self.assertIn(
            ([
                "podman", "build", "-t", "docker.io/cin0143/frontend:entrega-2",
                "--build-arg", "NEXT_PUBLIC_PAYMENT_URL=http://localhost:8000", "./frontend",
            ], None),
            commands,
        )
        self.assertEqual(
            len([command for command, _ in commands if command[:2] == ["podman", "save"]]),
            5,
        )
        loads = [entry for entry in commands if entry[0][:3] == ["kind", "load", "image-archive"]]
        self.assertEqual(len(loads), 5)
        self.assertTrue(all(env and env["KIND_EXPERIMENTAL_PROVIDER"] == "podman" for _, env in loads))
        self.assertTrue(all(command[-2:] == ["--name", "cin0143"] for command, _ in loads))
        self.assertIn((["kubectl", "apply", "-f", "k8s/"], None), commands)
        for service in setup_k8s.SERVICES:
            self.assertIn(
                (["kubectl", "rollout", "status", f"deployment/{service}", "--timeout=120s"], None),
                commands,
            )
        for resource in ("deployments", "pods", "services"):
            self.assertIn((["kubectl", "get", resource], None), commands)

    def test_kind_cluster_name_accepts_the_required_context(self) -> None:
        completed = subprocess.CompletedProcess(
            ["kubectl", "config", "current-context"],
            0,
            stdout="kind-cin0143\n",
        )

        with patch.object(setup_k8s.subprocess, "run", return_value=completed):
            self.assertEqual(setup_k8s.kind_cluster_name(), "cin0143")

    def test_kind_cluster_name_rejects_a_different_kind_cluster(self) -> None:
        completed = subprocess.CompletedProcess(
            ["kubectl", "config", "current-context"],
            0,
            stdout="kind-outro-cluster\n",
        )

        with patch.object(setup_k8s.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(RuntimeError, "kind-cin0143"):
                setup_k8s.kind_cluster_name()

    def test_verify_cluster_requires_nodes_from_the_podman_provider(self) -> None:
        commands: list[tuple[list[str], dict[str, str] | None]] = []

        def capture(command: list[str], *, env: dict[str, str] | None = None) -> None:
            commands.append((command, env))

        with patch.object(setup_k8s, "kind_cluster_name", return_value="cin0143"), \
                patch.object(setup_k8s, "kind_provider_nodes") as provider_nodes, \
                patch.object(setup_k8s, "run", side_effect=capture):
            self.assertEqual(setup_k8s.verify_cluster(), "cin0143")

        self.assertIn((["kubectl", "get", "nodes"], None), commands)
        provider_nodes.assert_called_once_with("cin0143")

    def test_images_use_the_same_canonical_name_in_build_save_and_manifests(self) -> None:
        commands: list[list[str]] = []

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(setup_k8s, "run", side_effect=lambda command, **_: commands.append(command)):
            setup_k8s.build_images()
            setup_k8s.load_images(Path(directory), "cin0143")

        for service in setup_k8s.SERVICES:
            image = f"docker.io/cin0143/{service}:entrega-2"
            self.assertTrue(any(command[:4] == ["podman", "build", "-t", image] for command in commands))
            self.assertTrue(any(command[:2] == ["podman", "save"] and command[-1] == image for command in commands))

            manifest = (setup_k8s.ROOT / "k8s" / f"{service}.yaml").read_text()
            self.assertIn(f"image: {image}", manifest)
            self.assertIn("imagePullPolicy: IfNotPresent", manifest)

    def test_kind_provider_nodes_rejects_an_empty_result(self) -> None:
        completed = subprocess.CompletedProcess(
            ["kind", "get", "nodes", "--name", "course-project"],
            0,
            stdout="",
        )

        with patch.object(setup_k8s.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(RuntimeError, "Podman"):
                setup_k8s.kind_provider_nodes("course-project")


class PortForwardTests(unittest.TestCase):
    def test_start_port_forwards_targets_the_public_services(self) -> None:
        first = MagicMock()
        second = MagicMock()

        with patch.object(port_forward.subprocess, "Popen", side_effect=[first, second]) as popen:
            processes = port_forward.start_port_forwards()

        self.assertEqual(processes, [first, second])
        self.assertEqual(
            popen.call_args_list[0].args[0],
            ["kubectl", "port-forward", "service/frontend", "3000:3000"],
        )
        self.assertEqual(
            popen.call_args_list[1].args[0],
            ["kubectl", "port-forward", "service/payment-service", "8000:8000"],
        )

    def test_start_port_forwards_cleans_up_if_the_second_process_fails(self) -> None:
        frontend = MagicMock()
        frontend.poll.return_value = None

        with patch.object(
            port_forward.subprocess,
            "Popen",
            side_effect=[frontend, FileNotFoundError("kubectl")],
        ):
            with self.assertRaises(FileNotFoundError):
                port_forward.start_port_forwards()
        frontend.terminate.assert_called_once_with()
        frontend.wait.assert_called_once_with(timeout=5)

    def test_cleanup_terminates_live_processes_and_kills_timeouts(self) -> None:
        live = MagicMock()
        live.poll.return_value = None
        live.wait.side_effect = [subprocess.TimeoutExpired("kubectl", 5), None]
        exited = MagicMock()
        exited.poll.return_value = 0

        port_forward.cleanup([live, exited])

        live.terminate.assert_called_once_with()
        live.kill.assert_called_once_with()
        self.assertEqual(live.wait.call_count, 2)
        exited.terminate.assert_not_called()
        exited.wait.assert_called_once_with(timeout=5)


class _TempDir:
    def __init__(self, name: str) -> None:
        self.name = name

    def __enter__(self) -> str:
        return self.name

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> bool:
        return False


if __name__ == "__main__":
    unittest.main()
