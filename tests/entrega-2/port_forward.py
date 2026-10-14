from __future__ import annotations

import signal
import subprocess
import sys
import time


def start_port_forwards() -> list[subprocess.Popen[object]]:
    print("==> Iniciando port-forward do frontend em http://localhost:3000")
    frontend = subprocess.Popen([
        "kubectl",
        "port-forward",
        "service/frontend",
        "3000:3000",
    ])
    print("==> Iniciando port-forward do payment-service em http://localhost:8000")
    try:
        payment = subprocess.Popen([
            "kubectl",
            "port-forward",
            "service/payment-service",
            "8000:8000",
        ])
    except BaseException:
        cleanup([frontend])
        raise
    return [frontend, payment]


def cleanup(processes: list[subprocess.Popen[object]]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()

    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def _interrupt_handler(signum: int, frame: object) -> None:
    raise KeyboardInterrupt


def main() -> int:
    processes: list[subprocess.Popen[object]] = []
    previous_sigint = signal.signal(signal.SIGINT, _interrupt_handler)
    previous_sigterm = signal.signal(signal.SIGTERM, _interrupt_handler)
    try:
        processes = start_port_forwards()
        print("Pressione Ctrl+C para encerrar os port-forwards.")
        while True:
            for process in processes:
                status = process.poll()
                if status is not None:
                    return status
            time.sleep(0.25)
    except KeyboardInterrupt:
        return 0
    except FileNotFoundError as error:
        print(f"Erro ao iniciar port-forward: {error}", file=sys.stderr)
        return 1
    finally:
        cleanup(processes)
        signal.signal(signal.SIGINT, previous_sigint)
        signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    raise SystemExit(main())
