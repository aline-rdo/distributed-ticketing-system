"""Testes do avaliador (manutenção docente), sem necessidade de cluster."""
import copy
from datetime import datetime, timezone
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import subprocess
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import test_autoscaling as evaluator


def configuration():
    deployment = {
        "apiVersion": "apps/v1", "kind": "Deployment",
        "metadata": {"name": "payment-service"},
        "spec": {"replicas": 1, "template": {"spec": {"containers": [{
            "name": "payment-service",
            "env": [{"name": "REQUEST_MEMORY_MB", "value": "10"}],
            "resources": {"requests": {"cpu": "200m", "memory": "64Mi"},
                          "limits": {"cpu": "300m", "memory": "256Mi"}},
        }]}}},
    }
    hpa = {
        "apiVersion": "autoscaling/v2", "kind": "HorizontalPodAutoscaler",
        "metadata": {"name": "payment-service-hpa"},
        "spec": {"minReplicas": 1, "maxReplicas": 3,
                 "scaleTargetRef": {"apiVersion": "apps/v1", "kind": "Deployment", "name": "payment-service"},
                 "metrics": [{"type": "Resource", "resource": {"name": "memory", "target": {
                     "type": "AverageValue", "averageValue": "90Mi"}}}]},
    }
    workloads = [{"metadata": {"name": name}, "spec": {"replicas": 1}}
                 for name in ("frontend", "tickets-service", "email-service", "analytics-service")]
    return deployment, hpa, workloads


class ConfigurationTests(unittest.TestCase):
    def test_manifest_live_comparison_accepts_normalized_quantities(self):
        d, h, workloads = configuration()
        d["spec"]["template"]["spec"]["containers"][0]["resources"]["limits"]["memory"] = "0.25Gi"
        live = copy.deepcopy(d)
        live["spec"]["template"]["spec"]["containers"][0]["resources"]["limits"]["memory"] = "256Mi"
        live_hpa = copy.deepcopy(h)
        live_hpa["spec"]["metrics"][0]["resource"]["target"]["averageValue"] = "94371840"

        def get(args):
            if args[1] == "deployments":
                return {"items": workloads}
            if args[1] == "deployment":
                return live
            if args[1] == "hpa":
                return {"items": [live_hpa]}
            if args[1] == "service":
                return {"spec": {"type": "ClusterIP"}}
            raise AssertionError(args)

        with patch.object(evaluator, "manifest_objects", side_effect=[[d], [h]]), \
                patch.object(evaluator, "kubectl_json", side_effect=get):
            evaluator.validate_manifests()

    def test_reads_consecutive_json_documents_from_kubectl_dry_run(self):
        with patch.object(evaluator, "kubectl_text", return_value='{"kind":"Deployment"}\n{"kind":"Service"}'):
            self.assertEqual(evaluator.manifest_objects("k8s/payment-service.yaml"),
                             [{"kind": "Deployment"}, {"kind": "Service"}])

    def test_accepts_equivalent_quantities_and_alternative_target(self):
        for target in ("90Mi", "94371840", "100Mi"):
            d, h, w = configuration()
            h["spec"]["metrics"][0]["resource"]["target"]["averageValue"] = target
            evaluator.validate_configuration(d, h, w)
        self.assertEqual(evaluator.memory_bytes("90Mi"), Decimal(94371840))
        self.assertEqual(evaluator.memory_bytes("1.5Gi"), Decimal(1610612736))
        self.assertEqual(evaluator.memory_bytes("1e6"), Decimal(1000000))

    def test_rejects_wrong_hpa_contract(self):
        for key, value in (("minReplicas", 2), ("maxReplicas", 4), ("metrics", []),
                           ("scaleTargetRef", {"name": "email-service"})):
            d, h, w = configuration()
            h["spec"][key] = value
            with self.subTest(key=key), self.assertRaises(evaluator.EvaluationError):
                evaluator.validate_configuration(d, h, w)
        for name, kind in (("cpu", "AverageValue"), ("memory", "AverageUtilization")):
            d, h, w = configuration()
            resource = h["spec"]["metrics"][0]["resource"]
            resource["name"] = name
            resource["target"]["type"] = kind
            with self.assertRaises(evaluator.EvaluationError):
                evaluator.validate_configuration(d, h, w)

    def test_rejects_missing_or_invalid_memory_and_wrong_artificial_load(self):
        for value in ("0", "-1Mi", "NaN", "garbage", None):
            d, h, w = configuration()
            d["spec"]["template"]["spec"]["containers"][0]["resources"]["limits"]["memory"] = value
            with self.subTest(value=value), self.assertRaises(evaluator.EvaluationError):
                evaluator.validate_configuration(d, h, w)
        d, h, w = configuration()
        d["spec"]["template"]["spec"]["containers"][0]["env"][0]["value"] = "0"
        with self.assertRaises(evaluator.EvaluationError):
            evaluator.validate_configuration(d, h, w)

    def test_rejects_request_above_limit_and_scaled_other_service(self):
        d, h, w = configuration()
        d["spec"]["template"]["spec"]["containers"][0]["resources"]["requests"]["memory"] = "512Mi"
        with self.assertRaises(evaluator.EvaluationError):
            evaluator.validate_configuration(d, h, w)
        d, h, w = configuration()
        w[0]["spec"]["replicas"] = 2
        with self.assertRaises(evaluator.EvaluationError):
            evaluator.validate_configuration(d, h, w)

    def test_missing_hpa_is_diagnostic(self):
        d, _, w = configuration()
        with self.assertRaisesRegex(evaluator.EvaluationError, "HPA"):
            evaluator.validate_configuration(d, {}, w)

    def test_wrong_context_is_rejected_before_reading_cluster(self):
        with patch.object(evaluator, "kubectl_text", return_value="kind-other"):
            with self.assertRaisesRegex(evaluator.EvaluationError, "kind-cin0143"):
                evaluator.verify_context()


def snapshot(replicas=1, available=None, memory="120Mi"):
    _, hpa, _ = configuration()
    hpa["status"] = {"desiredReplicas": replicas}
    pods = [{"metadata": {"name": f"payment-{i}", "uid": str(i)},
             "status": {"phase": "Running", "containerStatuses": [{
                 "name": "payment-service", "restartCount": 0,
                 "ready": True, "state": {"running": {}}, "lastState": {}}]}}
            for i in range(replicas)]
    return {"hpa": hpa, "deployment": {"spec": {"replicas": replicas},
            "status": {"replicas": replicas, "availableReplicas": replicas if available is None else available}},
            "pods": pods, "metrics": [{"metadata": {"name": p["metadata"]["name"]},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "containers": [{"name": "payment-service", "usage": {"memory": memory}}]} for p in pods]}


class ObservationTests(unittest.TestCase):
    def test_metric_outage_recovers_but_persistent_loss_is_infrastructure(self):
        with patch.object(evaluator.time, "monotonic", return_value=0):
            monitor = evaluator.MetricsMonitor()
        missing = {**snapshot(), "metrics": [], "metrics_error": "API indisponível"}
        with patch.object(evaluator.time, "monotonic", return_value=30):
            self.assertFalse(monitor.check(missing))
            self.assertTrue(monitor.check(snapshot()))
        with patch.object(evaluator.time, "monotonic", return_value=80):
            self.assertFalse(monitor.check(missing))
        with patch.object(evaluator.time, "monotonic", return_value=91):
            with self.assertRaisesRegex(evaluator.EvaluationError, "Infraestrutura.*API indisponível"):
                monitor.check(missing)

    def test_scale_up_with_new_pod_missing_metrics_reaches_approval(self):
        partial = snapshot(2)
        partial["metrics"].pop()
        partial["hpa"]["status"]["currentMetrics"] = [{"type": "Resource", "resource": {
            "name": "memory", "current": {"averageValue": "120Mi"}}}]
        full = snapshot(2, memory="65Mi")
        state = {"phase": 0}
        load = SimpleNamespace(errors=[], process=SimpleNamespace(poll=lambda: None, returncode=0))
        def command(**kwargs):
            state.update(kwargs)
        def collect(results):
            if state["phase"] == 1 and not results.tickets:
                results.add({"type": "checkout", "phase": 1, "worker": 0, "status": 200, "body": {
                    "paymentResult": "success", "ticketResult": "success", "emailResult": "success",
                    "ticketId": "4cb3f466-f3d3-420a-983c-486b96c06ef3"}})
            if state.get("stopped"):
                results.add({"type": "done"})
        load.command = command
        load.collect = collect
        load.stop = lambda: state.update(stopped=True)
        def observe():
            if "workers" not in state:
                return snapshot(memory="20Mi")
            value = copy.deepcopy(partial if not state["phase"] else full)
            for metric in value["metrics"]:
                metric["timestamp"] = datetime.now(timezone.utc).isoformat()
            return value
        clock = [0]
        def advance(seconds):
            clock[0] += seconds
        with patch.object(evaluator, "wait_for_metrics", return_value=snapshot(memory="20Mi")), \
                patch.object(evaluator.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(evaluator.time, "sleep", side_effect=advance), \
                patch.object(evaluator, "observe_cluster", side_effect=observe), \
                patch.object(evaluator, "kubectl_json", return_value={"items": [{"metadata": {"name": "frontend"}}]}), \
                patch.object(evaluator, "Load", return_value=load):
            evaluator.run_assessment()
        self.assertTrue(state["stopped"])

    def test_requires_available_replicas_and_measured_increase(self):
        self.assertFalse(evaluator.scaled(snapshot(2, available=1)))
        self.assertTrue(evaluator.scaled(snapshot(2)))
        self.assertIsNone(evaluator.measured_memory({**snapshot(), "metrics": []}))
        self.assertEqual(evaluator.measured_memory(snapshot()), Decimal(125829120))

    def test_stale_metrics_and_partial_samples_cannot_prove_load(self):
        state = snapshot()
        state["metrics"][0]["timestamp"] = "2000-01-01T00:00:00Z"
        self.assertIsNone(evaluator.measured_memory(state))
        state = snapshot(2)
        state["metrics"].pop()
        self.assertIsNone(evaluator.measured_memory(state))

    def test_pre_scaled_deployment_rejected(self):
        with self.assertRaisesRegex(evaluator.EvaluationError, "réplica"):
            evaluator.require_idle(snapshot(2))

    def test_restarts_new_pod_oom_and_disappearance_rejected(self):
        for mode in ("restart", "oom", "disappear"):
            with self.subTest(mode=mode):
                monitor = evaluator.PodMonitor()
                monitor.check(snapshot()["pods"])
                state = snapshot(2)
                if mode == "restart":
                    state["pods"][0]["status"]["containerStatuses"][0]["restartCount"] = 1
                elif mode == "oom":
                    state["pods"][1]["status"]["containerStatuses"][0]["lastState"] = {"terminated": {"reason": "OOMKilled"}}
                else:
                    state["pods"].pop(0)
                with self.assertRaises(evaluator.EvaluationError):
                    monitor.check(state["pods"])

    def test_temporary_metrics_absence_waits_but_deadline_fails(self):
        with patch.object(evaluator, "observe_cluster", side_effect=[{**snapshot(), "metrics": []}, snapshot()]), \
                patch.object(evaluator.time, "sleep"):
            self.assertIsNotNone(evaluator.wait_for_metrics(10))
        with patch.object(evaluator, "observe_cluster", return_value={**snapshot(), "metrics": []}), \
                patch.object(evaluator.time, "monotonic", side_effect=[0, 0, 100]), \
                patch.object(evaluator.time, "sleep"):
            with self.assertRaisesRegex(evaluator.EvaluationError, "métricas"):
                evaluator.wait_for_metrics(10)

    def test_metrics_ready_before_hpa_first_calculation_must_wait(self):
        pending = snapshot()
        pending["hpa"]["status"]["desiredReplicas"] = 0
        with patch.object(evaluator, "observe_cluster", side_effect=[pending, snapshot()]), \
                patch.object(evaluator.time, "sleep"):
            state = evaluator.wait_for_metrics(10)
            self.assertEqual(state["hpa"]["status"]["desiredReplicas"], 1)


class CheckoutTests(unittest.TestCase):
    def test_rejects_incorrect_success_bodies_and_http_failures(self):
        body = {"paymentResult": "success", "ticketResult": "success", "emailResult": "success",
                "ticketId": "4cb3f466-f3d3-420a-983c-486b96c06ef3"}
        evaluator.validate_checkout(200, body)
        for status, data in ((502, body), (200, {}), (200, []), (200, {**body, "ticketId": "invalid"}),
                             (200, {**body, "emailResult": "failed"})):
            with self.subTest(status=status, data=data), self.assertRaises(evaluator.EvaluationError):
                evaluator.validate_checkout(status, data)

    def test_duplicate_ticket_and_transport_error_fail(self):
        record = {"type": "checkout", "status": 200, "body": {
            "paymentResult": "success", "ticketResult": "success", "emailResult": "success",
            "ticketId": "4cb3f466-f3d3-420a-983c-486b96c06ef3"}, "worker": 0, "started": 1}
        results = evaluator.CheckoutResults()
        results.add(record)
        with self.assertRaisesRegex(evaluator.EvaluationError, "repetido"):
            results.add(record)
        with self.assertRaisesRegex(evaluator.EvaluationError, "timeout"):
            results.add({"type": "checkout", "error": "timeout"})


class ClientTests(unittest.TestCase):
    """Exercita o cliente Node real com um servidor HTTP local controlado."""
    def run_client(self, response=b'{}', delay=0, timeout=1000, lifetime=200):
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                time.sleep(delay)
                try:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(response)
                except BrokenPipeError:
                    pass

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            config = {"url": f"http://127.0.0.1:{server.server_port}/payment-service",
                      "timeout": timeout, "lifetime": lifetime}
            process = subprocess.Popen(["node", "-e", evaluator.LOAD_CLIENT, json.dumps(config)],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                process.stdin.write('{"workers":1,"phase":1}\n')
                process.stdin.flush()
                process.wait(timeout=3)
                output = process.stdout.read()
                self.assertEqual(process.returncode, 0, process.stderr.read())
                return [json.loads(line) for line in output.splitlines()]
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                for stream in (process.stdin, process.stdout, process.stderr):
                    stream.close()
                server.shutdown()
                thread.join()

    def test_lifetime_stops_new_requests_and_drains_inflight(self):
        records = self.run_client(delay=0.1, lifetime=30)
        self.assertEqual([r["type"] for r in records], ["checkout", "done"])
        self.assertEqual(records[0]["phase"], 1)
        self.assertEqual(records[0]["status"], 200)

    def test_invalid_json_is_reported(self):
        records = self.run_client(response=b'not-json', delay=0.05, lifetime=10)
        self.assertIn("JSON inválido", records[0]["error"])

    def test_absolute_timeout_is_reported_and_client_exits(self):
        records = self.run_client(delay=0.15, timeout=50, lifetime=10)
        self.assertIn("timeout", records[0]["error"])
        self.assertEqual(records[-1]["type"], "done")


if __name__ == "__main__":
    unittest.main()
