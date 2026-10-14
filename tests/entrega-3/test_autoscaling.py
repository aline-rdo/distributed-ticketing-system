"""Avaliação da Entrega 3. Requer a aplicação e Metrics Server no kind-cin0143."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
import json
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
CONTEXT = "kind-cin0143"
PAYMENT = "payment-service"
HPA = "payment-service-hpa"
OTHERS = {"frontend", "tickets-service", "email-service", "analytics-service"}
POLL_SECONDS = 5
STAGES = (1, 2, 4, 10)
STAGE_SECONDS = 30
LOAD_SECONDS = 240

# node -e mantém stdin disponível para comandos de concorrência/finalização.
LOAD_CLIENT = r'''
const http = require('node:http');
const readline = require('node:readline');
const config = JSON.parse(process.argv[1]);
const input = readline.createInterface({input: process.stdin});
let stopping = false, workers = 0, active = 0, phase = 0;
const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
const lifetime = setTimeout(stop, config.lifetime);
function finish() {
  if (stopping && active === 0) {
    clearTimeout(lifetime);
    emit({type: 'done'});
    input.close();
    process.stdin.pause();
  }
}
function stop() { if (!stopping) { stopping = true; finish(); } }
async function checkout(worker) {
  const started = Date.now(), requestPhase = phase;
  const payload = JSON.stringify({cart: [{id: 1, name: 'Friday', price: 125}], total: 131.25});
  const result = await new Promise(resolve => {
    let settled = false;
    const end = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const req = http.request(config.url, {method: 'POST', agent: false,
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}}, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(new Error('resposta muito grande')); });
      res.on('error', error => end({error: error.message}));
      res.on('end', () => { try { end({status: res.statusCode, body: JSON.parse(body)}); }
        catch { end({error: 'JSON inválido na resposta'}); } });
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout de compra')), config.timeout);
    req.on('error', error => end({error: error.message}));
    req.end(payload);
  });
  emit({type: 'checkout', worker, started, phase: requestPhase, ...result});
}
async function work(worker) {
  active++;
  try { while (!stopping) await checkout(worker); }
  finally { active--; finish(); }
}
input.on('line', line => {
  try {
    const command = JSON.parse(line);
    if (command.stop) return stop();
    if (stopping) return;
    if (command.phase !== undefined) phase = command.phase;
    while (workers < command.workers) work(workers++);
  } catch { emit({type: 'error', error: 'comando inválido'}); stop(); }
});
input.on('close', stop);
process.on('SIGTERM', stop);
'''


class EvaluationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvaluationError(message)


def kubectl_text(args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["kubectl", "--context", CONTEXT, "-n", "default", "--request-timeout=10s", *args],
            cwd=ROOT, capture_output=True, text=True, timeout=15, check=True,
        )
        return result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", "") or str(error)
        raise EvaluationError(f"kubectl {' '.join(args)}: {detail.strip()}") from error


def kubectl_json(args: list[str]) -> dict:
    try:
        result = json.loads(kubectl_text(args))
        require(isinstance(result, dict), "Resposta Kubernetes não é um objeto JSON.")
        return result
    except json.JSONDecodeError as error:
        raise EvaluationError("Resposta inválida da API Kubernetes.") from error


def verify_context() -> None:
    require(kubectl_text(["config", "current-context"]) == CONTEXT,
            f"Selecione o contexto {CONTEXT} antes de executar a avaliação.")


def memory_bytes(value: str) -> Decimal:
    match = re.fullmatch(r"([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([KMGTPE]i|[kKMGTPE]|m|u|n)?", str(value))
    require(match is not None, f"Quantidade de recurso inválida: {value!r}.")
    number, suffix = match.groups()
    if suffix and suffix.endswith("i"):
        multiplier = Decimal(1024) ** ("KMGTPE".index(suffix[0]) + 1)
    elif suffix in ("m", "u", "n"):
        multiplier = {"m": Decimal("0.001"), "u": Decimal("0.000001"), "n": Decimal("0.000000001")}[suffix]
    elif suffix:
        multiplier = Decimal(1000) ** ("KMGTPE".index(suffix.upper()) + 1)
    else:
        multiplier = Decimal(1)
    try:
        result = Decimal(number) * multiplier
    except InvalidOperation as error:
        raise EvaluationError(f"Quantidade inválida: {value!r}.") from error
    require(result.is_finite() and result > 0, f"Quantidade deve ser positiva: {value!r}.")
    return result


def payment_container(deployment: dict) -> dict:
    containers = deployment.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [])
    require(len(containers) == 1 and containers[0].get("name") == PAYMENT,
            "Deployment de pagamentos deve manter seu único container payment-service.")
    return containers[0]


def validate_configuration(deployment: dict, hpa: dict, workloads: list[dict]) -> None:
    require(hpa.get("apiVersion") == "autoscaling/v2" and hpa.get("kind") == "HorizontalPodAutoscaler"
            and hpa.get("metadata", {}).get("name") == HPA,
            f"HPA ausente ou inválido: crie {HPA} com autoscaling/v2.")
    spec = hpa.get("spec", {})
    require(spec.get("scaleTargetRef") == {"apiVersion": "apps/v1", "kind": "Deployment", "name": PAYMENT},
            "HPA deve apontar para o Deployment payment-service.")
    require(spec.get("minReplicas") == 1 and spec.get("maxReplicas") == 3,
            "HPA deve usar minReplicas=1 e maxReplicas=3.")
    metrics = spec.get("metrics", [])
    require(len(metrics) == 1 and metrics[0].get("type") == "Resource", "Configure somente uma métrica Resource.")
    resource = metrics[0].get("resource", {})
    require(resource.get("name") == "memory" and resource.get("target", {}).get("type") == "AverageValue",
            "Use memory com alvo AverageValue.")
    memory_bytes(resource["target"].get("averageValue"))
    container = payment_container(deployment)
    env = [item for item in container.get("env", []) if item.get("name") == "REQUEST_MEMORY_MB"]
    require(env == [{"name": "REQUEST_MEMORY_MB", "value": "10"}], "Declare REQUEST_MEMORY_MB=10 explicitamente.")
    resources = container.get("resources", {})
    for resource_name in ("cpu", "memory"):
        request = memory_bytes(resources.get("requests", {}).get(resource_name))
        limit = memory_bytes(resources.get("limits", {}).get(resource_name))
        require(request <= limit, f"request de {resource_name} não pode ultrapassar limit.")
        if resource_name == "cpu":
            require(request == Decimal("0.2") and limit == Decimal("0.3"), "Preserve CPU: request 200m e limit 300m.")
    found = {item["metadata"]["name"]: item for item in workloads}
    for name in OTHERS:
        require(name in found and found[name].get("spec", {}).get("replicas", 1) == 1,
                f"Mantenha uma réplica de {name}.")


def manifest_objects(path: str) -> list[dict]:
    require((ROOT / path).is_file(), f"Arquivo obrigatório ausente: {path}.")
    output = kubectl_text(["create", "--dry-run=client", "-f", path, "-o", "json"])
    objects = []
    try:
        while output.strip():
            item, end = json.JSONDecoder().raw_decode(output.lstrip())
            objects.extend(item.get("items", [item]))
            output = output.lstrip()[end:]
    except (json.JSONDecodeError, AttributeError) as error:
        raise EvaluationError(f"Manifest inválido: {path}.") from error
    return objects


def validate_manifests() -> None:
    objects = manifest_objects("k8s/payment-service.yaml")
    deployments = [item for item in objects if item.get("kind") == "Deployment"]
    require(len(deployments) == 1 and deployments[0]["metadata"]["name"] == PAYMENT,
            "Manifest deve conter o Deployment payment-service.")
    deployment = deployments[0]
    require(deployment["spec"].get("replicas") == 1, "Manifest deve iniciar com replicas: 1.")
    hpas = manifest_objects("k8s/payment-service-hpa.yaml")
    require(len(hpas) == 1, "Forneça somente o HPA de pagamentos nesse arquivo.")
    workloads = kubectl_json(["get", "deployments", "-o", "json"])["items"]
    validate_configuration(deployment, hpas[0], workloads)
    live = kubectl_json(["get", "deployment", PAYMENT, "-o", "json"])
    live_hpas = kubectl_json(["get", "hpa", "-o", "json"])["items"]
    require(len(live_hpas) == 1, "Mantenha somente o HPA de pagamentos no namespace default.")
    validate_configuration(live, live_hpas[0], workloads)
    require(payment_container(live).get("env") == payment_container(deployment).get("env"),
            "Configuração aplicada difere do arquivo. Execute kubectl apply -f k8s/.")
    for section in ("requests", "limits"):
        actual = payment_container(live)["resources"][section]
        expected = payment_container(deployment)["resources"][section]
        require({k: memory_bytes(v) for k, v in actual.items()} ==
                {k: memory_bytes(v) for k, v in expected.items()},
                "Recursos aplicados diferem do arquivo. Execute kubectl apply -f k8s/.")
    for key in ("scaleTargetRef", "minReplicas", "maxReplicas"):
        require(live_hpas[0]["spec"].get(key) == hpas[0]["spec"].get(key),
                "HPA aplicado difere do arquivo. Execute kubectl apply -f k8s/.")
    actual_target = live_hpas[0]["spec"]["metrics"][0]["resource"]["target"]["averageValue"]
    expected_target = hpas[0]["spec"]["metrics"][0]["resource"]["target"]["averageValue"]
    require(memory_bytes(actual_target) == memory_bytes(expected_target),
            "Alvo aplicado difere do arquivo. Execute kubectl apply -f k8s/.")
    for name in OTHERS | {PAYMENT}:
        service = kubectl_json(["get", "service", name, "-o", "json"])
        require(service["spec"].get("type", "ClusterIP") == "ClusterIP", f"Preserve Service ClusterIP: {name}.")


def validate_checkout(status: int, body: dict) -> None:
    require(status == 200 and isinstance(body, dict), f"Compra inválida: HTTP {status}, corpo {body!r}.")
    require(all(body.get(key) == "success" for key in ("paymentResult", "ticketResult", "emailResult")),
            f"Compra não concluiu todas as etapas: {body!r}.")
    try:
        UUID(body["ticketId"])
    except (KeyError, ValueError, TypeError, AttributeError) as error:
        raise EvaluationError("Compra retornou ticketId inválido.") from error


class CheckoutResults:
    def __init__(self):
        self.tickets = set()
        self.final_workers = set()
        self.done = False

    def add(self, record: dict) -> None:
        if record.get("type") == "done":
            self.done = True
            return
        require(not record.get("error"), f"Falha de compra/gerador: {record.get('error')}.")
        require(record.get("type") == "checkout", "Registro desconhecido do gerador.")
        validate_checkout(record.get("status"), record.get("body"))
        ticket = str(UUID(record["body"]["ticketId"]))
        require(ticket not in self.tickets, "ticketId repetido em compras diferentes.")
        self.tickets.add(ticket)
        if record.get("phase") == 1:
            self.final_workers.add(record["worker"])


def observe_cluster() -> dict:
    state = {
        "hpa": kubectl_json(["get", "hpa", HPA, "-o", "json"]),
        "deployment": kubectl_json(["get", "deployment", PAYMENT, "-o", "json"]),
        "pods": kubectl_json(["get", "pods", "-l", "app=payment-service", "-o", "json"])["items"],
    }
    try:
        state["metrics"] = kubectl_json(["get", "--raw", "/apis/metrics.k8s.io/v1beta1/namespaces/default/pods"])["items"]
    except EvaluationError as error:
        state["metrics"] = []
        state["metrics_error"] = str(error)
    return state


def measured_memory(state: dict, *, since: datetime | None = None) -> Decimal | None:
    names = {p["metadata"]["name"] for p in state["pods"]}
    values = {}
    now = datetime.now(timezone.utc)
    for item in state["metrics"]:
        name = item["metadata"]["name"]
        if name not in names:
            continue
        timestamp = datetime.fromisoformat(item["timestamp"].replace("Z", "+00:00"))
        if not 0 <= (now - timestamp).total_seconds() <= 60 or (since and timestamp < since):
            continue
        for container in item["containers"]:
            if container["name"] == PAYMENT:
                values[name] = memory_bytes(container["usage"]["memory"])
    if not names or names != values.keys():
        return None
    return sum(values.values()) / len(values)


def require_idle(state: dict) -> None:
    spec, status = state["deployment"]["spec"], state["deployment"].get("status", {})
    require(spec.get("replicas") == 1 and status.get("replicas") == 1
            and status.get("availableReplicas") == 1 and len(state["pods"]) == 1
            and state["hpa"].get("status", {}).get("desiredReplicas", 1) == 1,
            "O teste precisa iniciar com uma réplica disponível e permanecer assim em repouso. "
            "Se já executou a carga, siga 'Repetir o teste' em requisitos/entrega-3.md; "
            "caso contrário, investigue o alvo de memória em repouso.")


def memory_evidence(state: dict, since: datetime) -> bool:
    target = memory_bytes(state["hpa"]["spec"]["metrics"][0]["resource"]["target"]["averageValue"])
    average = measured_memory(state, since=since)
    if average is not None:
        return average > target
    # O HPA pode ter criado um Pod antes da consulta seguinte. Correlacionar
    # seu cálculo com amostras recentes dos Pods já medidos preserva a evidência
    # anterior à distribuição da carga; nunca atribuir zero ao Pod sem amostra.
    measured_names = {m["metadata"]["name"] for m in state["metrics"]}
    sampled = {**state, "pods": [p for p in state["pods"] if p["metadata"]["name"] in measured_names]}
    observed = measured_memory(sampled, since=since)
    for metric in state["hpa"].get("status", {}).get("currentMetrics", []):
        resource = metric.get("resource", {})
        current = resource.get("current", {}).get("averageValue")
        if resource.get("name") == "memory" and current:
            return observed is not None and observed > target and memory_bytes(current) > target
    return False


class MetricsMonitor:
    def __init__(self):
        self.last_valid = time.monotonic()

    def check(self, state: dict) -> bool:
        if measured_memory(state) is not None:
            self.last_valid = time.monotonic()
            return True
        reason = state.get("metrics_error", "amostras ausentes, incompletas ou antigas")
        require(time.monotonic() - self.last_valid < 60,
                f"Infraestrutura: métricas indisponíveis por 60s: {reason}.")
        print(f"Aguardando recuperação das métricas: {reason}", flush=True)
        return False


def scaled(state: dict) -> bool:
    return (2 <= state["hpa"].get("status", {}).get("desiredReplicas", 0) <= 3
            and 2 <= state["deployment"].get("status", {}).get("availableReplicas", 0) <= 3)


class PodMonitor:
    def __init__(self):
        self.counts = {}
        self.uids = set()

    def check(self, pods: list[dict]) -> None:
        uids = {pod["metadata"]["uid"] for pod in pods}
        require(self.uids <= uids, "Um Pod desapareceu durante a carga; investigue eventos e reinícios.")
        for pod in pods:
            uid, name = pod["metadata"]["uid"], pod["metadata"]["name"]
            for container in pod.get("status", {}).get("containerStatuses", []):
                key = (uid, container["name"])
                count = container.get("restartCount", 0)
                oom = any(container.get(field, {}).get("terminated", {}).get("reason") == "OOMKilled"
                          for field in ("state", "lastState"))
                require(not oom, f"OOMKilled em {name}: limite atingido antes/durante o scale-up. Investigue kubectl describe pod {name}.")
                require(count <= self.counts.get(key, 0), f"Container reiniciou em {name} durante a avaliação.")
                self.counts[key] = count
        self.uids = uids


def wait_for_metrics(seconds: int = 180) -> dict:
    deadline = time.monotonic() + seconds
    last_error = ""
    while time.monotonic() < deadline:
        state = observe_cluster()
        if (measured_memory(state) is not None
                and state["hpa"].get("status", {}).get("desiredReplicas", 0) > 0
                and not any(p["metadata"].get("deletionTimestamp") for p in state["pods"])):
            return state
        last_error = state.get("metrics_error", "dados ausentes, incompletos ou antigos")
        print(f"Aguardando métricas: {last_error}", flush=True)
        time.sleep(POLL_SECONDS)
    raise EvaluationError(f"Infraestrutura: métricas indisponíveis após {seconds}s: {last_error}.")


def report(state: dict) -> None:
    values = [(m["metadata"]["name"], m["timestamp"], c["usage"]["memory"])
              for m in state["metrics"] for c in m["containers"] if c["name"] == PAYMENT]
    target = state["hpa"]["spec"]["metrics"][0]["resource"]["target"]["averageValue"]
    average = measured_memory(state)
    mean = f"{average / 1048576:.1f}Mi" if average is not None else "amostra incompleta/antiga"
    print(f"Memória média={mean}; alvo={target}; desejadas={state['hpa'].get('status', {}).get('desiredReplicas', '?')}; "
          f"disponíveis={state['deployment'].get('status', {}).get('availableReplicas', 0)}; Pods={values}", flush=True)


class Load:
    def __init__(self, pod: str):
        config = json.dumps({"url": "http://payment-service:8000/payment-service", "timeout": 45000, "lifetime": 300000})
        self.process = subprocess.Popen(
            ["kubectl", "--context", CONTEXT, "-n", "default", "exec", "-i", pod, "--", "node", "-e", LOAD_CLIENT, config],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1,
        )
        self.records = queue.Queue()
        self.errors = []
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        self.error_reader = threading.Thread(target=self._errors, daemon=True)
        self.error_reader.start()

    def _read(self):
        for line in self.process.stdout:
            self.records.put(line)

    def _errors(self):
        for line in self.process.stderr:
            self.errors.append(line.strip())
            self.errors[:] = self.errors[-10:]

    def command(self, **command):
        try:
            self.process.stdin.write(json.dumps(command) + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as error:
            raise EvaluationError("Gerador encerrou antes da hora: " + " ".join(self.errors)) from error

    def collect(self, results: CheckoutResults):
        while True:
            try:
                line = self.records.get_nowait()
            except queue.Empty:
                break
            try:
                results.add(json.loads(line))
            except json.JSONDecodeError as error:
                raise EvaluationError(f"Saída inválida do gerador: {line[:200]}") from error

    def stop(self):
        if self.process.poll() is None:
            try:
                self.command(stop=True)
                self.process.stdin.close()
                self.process.wait(timeout=50)
            except (EvaluationError, subprocess.TimeoutExpired):
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
        self.reader.join(timeout=2)
        self.error_reader.join(timeout=2)


def run_assessment() -> None:
    print("1/3 — Verificando métricas e repouso por 30 segundos.", flush=True)
    state = wait_for_metrics()
    deadline = time.monotonic() + 30
    monitor = PodMonitor()
    metrics = MetricsMonitor()
    while True:
        require_idle(state)
        monitor.check(state["pods"])
        complete_metrics = metrics.check(state)
        report(state)
        if time.monotonic() >= deadline and complete_metrics:
            break
        time.sleep(POLL_SECONDS)
        state = observe_cluster()
    frontend = kubectl_json(["get", "pods", "-l", "app=frontend", "-o", "json"])["items"]
    require(len(frontend) == 1, "É necessário um Pod de frontend para gerar carga.")
    load = Load(frontend[0]["metadata"]["name"])
    results = CheckoutResults()
    start = time.monotonic()
    started_at = datetime.now(timezone.utc)
    evidence = False
    final = False
    workers = 0
    print("2/3 — Iniciando compras concorrentes; aguardando scale-up.", flush=True)
    try:
        while time.monotonic() - start < LOAD_SECONDS:
            elapsed = time.monotonic() - start
            desired_workers = STAGES[min(int(elapsed // STAGE_SECONDS), len(STAGES) - 1)]
            if not final and desired_workers != workers:
                workers = desired_workers
                load.command(workers=workers)
                print(f"Concorrência: {workers}", flush=True)
            load.collect(results)
            require(load.process.poll() is None, "Gerador encerrou antes da conclusão: " + " ".join(load.errors))
            state = observe_cluster()
            monitor.check(state["pods"])
            complete_metrics = metrics.check(state)
            require(state["deployment"]["spec"]["replicas"] <= 3
                    and state["hpa"].get("status", {}).get("desiredReplicas", 1) <= 3, "Escala ultrapassou três réplicas.")
            report(state)
            evidence |= memory_evidence(state, started_at)
            if evidence and scaled(state) and not final:
                final = True
                load.command(workers=workers, phase=1)
                print("3/3 — Scale-up observado. Validando novas compras após disponibilidade.", flush=True)
            if final and complete_metrics and results.final_workers == set(range(workers)):
                break
            time.sleep(POLL_SECONDS)
        else:
            raise EvaluationError("Prazo de carga esgotado: não houve scale-up seguido de compras válidas. "
                                  "Investigue alvo, condições do HPA e recursos disponíveis.")
    finally:
        load.stop()
    load.collect(results)
    require(load.process.returncode == 0 and results.done, "Gerador não confirmou encerramento limpo.")
    state = observe_cluster()
    monitor.check(state["pods"])
    require(measured_memory(state) is not None, "Infraestrutura: métricas ausentes no encerramento da carga.")
    require(scaled(state), "Réplicas deixaram de estar disponíveis ao final.")
    print(f"APROVADO: {len(results.tickets)} compras válidas, scale-up comprovado e nenhum reinício/OOM.", flush=True)


def main() -> int:
    try:
        verify_context()
        validate_manifests()
        run_assessment()
        return 0
    except (EvaluationError, KeyboardInterrupt) as error:
        print(f"FALHA: {error or 'avaliação interrompida'}", file=sys.stderr)
        print("Investigue: kubectl top pods; kubectl describe hpa payment-service-hpa; kubectl get pods", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
