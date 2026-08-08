#!/usr/bin/env python3
"""Idempotently provision the restricted SSH range worker with Docker Compose."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid

SCHEMA_VERSION = 1
REQUEST_LIMIT = 64 * 1024
HOST_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PUBLIC_KEY = re.compile(r"^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$")
OWNED_LABEL = "com.material-download-manager.managed=true"


class ProvisionError(RuntimeError):
    pass


def emit(stage: str, state: str, message: str) -> None:
    record = {"version": SCHEMA_VERSION, "stage": stage, "state": state, "message": message[:512]}
    print(json.dumps(record, separators=(",", ":")), flush=True)


def read_request() -> dict[str, object]:
    payload = sys.stdin.buffer.read(REQUEST_LIMIT + 1)
    if len(payload) > REQUEST_LIMIT:
        raise ProvisionError("Provision request exceeds its size limit")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProvisionError("Provision request is not valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ProvisionError("Provision request must be an object")
    return value


def exact_request(value: dict[str, object], action: str) -> dict[str, object]:
    base = {"version", "hostId"}
    if action in {"preflight", "apply", "verify", "rollback", "finalize"}:
        base |= {"workerPort", "relayPublicKey", "workerClientPublicKey", "specHash"}
    if action == "cleanup":
        base |= {"stagingDirectory"}
    if set(value) != base or value.get("version") != SCHEMA_VERSION:
        raise ProvisionError("Provision request has an unexpected schema")
    host_id = value.get("hostId")
    if not isinstance(host_id, str) or not HOST_ID.fullmatch(host_id):
        raise ProvisionError("Provision request hostId is invalid")
    if action in {"preflight", "apply", "verify", "rollback"}:
        port = value.get("workerPort")
        if not isinstance(port, int) or isinstance(port, bool) or port < 1024 or port > 65535:
            raise ProvisionError("Provision request workerPort is invalid")
        for field in ("relayPublicKey", "workerClientPublicKey"):
            key = value.get(field)
            if not isinstance(key, str) or len(key) > 16 * 1024 or not PUBLIC_KEY.fullmatch(key):
                raise ProvisionError(f"Provision request {field} is invalid")
        spec_hash = value.get("specHash")
        if not isinstance(spec_hash, str) or not SHA256.fullmatch(spec_hash):
            raise ProvisionError("Provision request specHash is invalid")
    return value


def run(command: list[str], cwd: Path | None = None, timeout: int = 1800) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=True,
            env={**os.environ, "DOCKER_BUILDKIT": "1"},
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        raise ProvisionError(f"Required command failed: {Path(command[0]).name}") from error


def require_command(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved:
        raise ProvisionError(f"Required command is unavailable: {name}")
    return resolved


def project_name(host_id: str) -> str:
    return f"mdm-ssh-worker-{host_id}"


def paths(host_id: str) -> dict[str, Path]:
    home = Path.home().resolve()
    root = (home / ".local" / "share" / "material-download-manager" / "ssh-worker" / host_id).resolve()
    expected_parent = (home / ".local" / "share" / "material-download-manager" / "ssh-worker").resolve()
    if root.parent != expected_parent:
        raise ProvisionError("Managed worker path escaped its expected parent")
    return {
        "home": home,
        "root": root,
        "current": root / "current",
        "previous": root / "previous",
        "previousState": root / "previous-state.json",
        "state": root / "state.json",
        "transaction": root / "transaction.json",
        "lock": root / ".lock",
    }


def preflight(request: dict[str, object]) -> None:
    emit("preflight", "running", "Checking Docker, Compose, capacity, and the selected loopback port.")
    docker = require_command("docker")
    run([docker, "version", "--format", "{{.Server.Version}}"], timeout=30)
    run([docker, "compose", "version", "--short"], timeout=30)
    machine = platform.machine().lower()
    if machine not in {"x86_64", "amd64", "aarch64", "arm64"}:
        raise ProvisionError("This worker image supports amd64 and arm64 hosts only")
    available = shutil.disk_usage(Path.home()).free
    if available < 2 * 1024 * 1024 * 1024:
        raise ProvisionError("At least 2 GiB of free disk space is required")
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        match = re.search(r"^MemAvailable:\s+(\d+)\s+kB$", meminfo.read_text("utf-8"), re.MULTILINE)
        if match and int(match.group(1)) * 1024 < 768 * 1024 * 1024:
            raise ProvisionError("At least 768 MiB of available memory is required")
    port = int(request["workerPort"])
    listener = run(["sh", "-c", f"ss -H -ltn 'sport = :{port}' 2>/dev/null || true"], timeout=15)
    if listener.stdout.strip():
        state_path = paths(str(request["hostId"]))["state"]
        if not state_path.exists():
            raise ProvisionError("The selected loopback port is already in use by an unmanaged listener")
    emit("preflight", "passed", "Host preflight passed without changing Docker workloads.")


def safe_bundle_directory() -> Path:
    bundle = Path(__file__).resolve().parent
    required = ["Dockerfile", "compose.yaml", "package.json", "package-lock.json", "tsconfig.json", "src"]
    if any(not (bundle / name).exists() for name in required):
        raise ProvisionError("Uploaded worker bundle is incomplete")
    return bundle


def write_environment(directory: Path, request: dict[str, object]) -> None:
    content = (
        f"MDM_WORKER_HOST_PORT={request['workerPort']}\n"
        f"MDM_WORKER_ALLOWED_KEYS={request['workerClientPublicKey']}\n"
    )
    env_path = directory / ".env"
    env_path.write_text(content, encoding="utf-8")
    os.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)


def authorize_relay(request: dict[str, object]) -> None:
    ssh_dir = Path.home() / ".ssh"
    ssh_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ssh_dir, 0o700)
    authorized = ssh_dir / "authorized_keys"
    lines = authorized.read_text("utf-8").splitlines() if authorized.exists() else []
    marker = f"mdm-relay-{request['hostId']}"
    lines = [line for line in lines if not line.endswith(f" {marker}")]
    port = int(request["workerPort"])
    key = str(request["relayPublicKey"])
    lines.append(
        f'restrict,port-forwarding,permitopen="127.0.0.1:{port}",command="/usr/bin/false" {key} {marker}'
    )
    temporary = authorized.with_name(f"authorized_keys.{uuid.uuid4().hex}.tmp")
    temporary.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, authorized)


def remove_relay(host_id: str) -> None:
    authorized = Path.home() / ".ssh" / "authorized_keys"
    if not authorized.exists():
        return
    marker = f"mdm-relay-{host_id}"
    lines = [line for line in authorized.read_text("utf-8").splitlines() if not line.endswith(f" {marker}")]
    temporary = authorized.with_name(f"authorized_keys.{uuid.uuid4().hex}.tmp")
    temporary.write_text(("\n".join(lines) + "\n") if lines else "", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, authorized)


def compose(request: dict[str, object], directory: Path, *arguments: str, timeout: int = 1800) -> None:
    docker = require_command("docker")
    run(
        [docker, "compose", "--project-name", project_name(str(request["hostId"])), "--file", "compose.yaml", *arguments],
        cwd=directory,
        timeout=timeout,
    )


def owned_containers(request: dict[str, object]) -> list[str]:
    docker = require_command("docker")
    result = run([
        docker,
        "ps",
        "--all",
        "--filter",
        f"label={OWNED_LABEL}",
        "--filter",
        f"label=com.docker.compose.project={project_name(str(request['hostId']))}",
        "--format",
        "{{.ID}}",
    ], timeout=30)
    return [line for line in result.stdout.splitlines() if re.fullmatch(r"[0-9a-f]{12,64}", line)]


def verify(request: dict[str, object]) -> None:
    target = paths(str(request["hostId"]))
    state_path = target["state"]
    if not target["current"].is_dir() or not state_path.is_file():
        raise ProvisionError("Managed worker state is missing")
    state = json.loads(state_path.read_text("utf-8"))
    if state.get("version") != SCHEMA_VERSION or state.get("specHash") != request["specHash"]:
        raise ProvisionError("Managed worker state does not match the requested specification")
    containers = owned_containers(request)
    if len(containers) != 1:
        raise ProvisionError("Exactly one label-owned worker container must exist")
    docker = require_command("docker")
    inspected = run([docker, "inspect", "--format", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", containers[0]], timeout=30)
    facts = inspected.stdout.strip().split()
    if not facts or facts[0] != "running" or (len(facts) > 1 and facts[1] != "healthy"):
        raise ProvisionError("The managed worker container is not running and healthy")
    emit("verify", "passed", "The label-owned worker container is running and healthy.")


def atomic_state(path: Path, value: dict[str, object]) -> None:
    temporary = path.with_name(f"state.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def read_transaction(target: dict[str, Path]) -> dict[str, object] | None:
    path = target["transaction"]
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProvisionError("The managed worker transaction journal is corrupt") from error
    if (
        not isinstance(value, dict)
        or value.get("version") != SCHEMA_VERSION
        or not isinstance(value.get("hostId"), str)
        or not isinstance(value.get("specHash"), str)
        or not SHA256.fullmatch(value["specHash"])
        or not isinstance(value.get("previousExisted"), bool)
        or value.get("phase") not in {"prepared", "swapped", "applied"}
    ):
        raise ProvisionError("The managed worker transaction journal has an invalid schema")
    return value


def write_transaction(target: dict[str, Path], request: dict[str, object], phase: str, previous_existed: bool, staged: Path | None = None) -> None:
    value: dict[str, object] = {
        "version": SCHEMA_VERSION,
        "hostId": request["hostId"],
        "specHash": request["specHash"],
        "phase": phase,
        "previousExisted": previous_existed,
    }
    if staged is not None:
        value["staged"] = str(staged)
    atomic_state(target["transaction"], value)


def clear_transaction(target: dict[str, Path]) -> None:
    target["transaction"].unlink(missing_ok=True)


def recover_transaction(request: dict[str, object], target: dict[str, Path], pending: dict[str, object]) -> None:
    """Finish or undo a journaled swap after a process crash.

    A pending journal is never silently treated as a healthy unchanged install:
    the next operation either resumes the exact applied spec or restores the
    last known-good directory before accepting a different one.
    """
    staged_raw = pending.get("staged")
    if isinstance(staged_raw, str):
        staged = Path(staged_raw).resolve()
        if staged.parent == target["root"].resolve() and staged.name.startswith("stage-"):
            shutil.rmtree(staged, ignore_errors=True)
    if pending.get("phase") == "prepared" and target["previous"].exists() is False:
        clear_transaction(target)
        return
    if target["previous"].is_dir():
        if target["current"].exists():
            try:
                compose(request, target["current"], "down", timeout=300)
            except Exception:
                pass
            shutil.rmtree(target["current"], ignore_errors=True)
        os.replace(target["previous"], target["current"])
        if target["previousState"].is_file():
            os.replace(target["previousState"], target["state"])
        try:
            compose(request, target["current"], "up", "--detach", "--build", "--wait", timeout=1800)
        except Exception as error:
            raise ProvisionError("The previous managed worker could not be restored after an interrupted operation") from error
    elif not bool(pending.get("previousExisted")):
        if target["current"].exists():
            try:
                compose(request, target["current"], "down", "--volumes", timeout=300)
            except Exception:
                pass
            shutil.rmtree(target["current"], ignore_errors=True)
        remove_relay(str(request["hostId"]))
        target["state"].unlink(missing_ok=True)
    clear_transaction(target)


def apply(request: dict[str, object]) -> str:
    target = paths(str(request["hostId"]))
    target["root"].mkdir(mode=0o700, parents=True, exist_ok=True)
    pending = read_transaction(target)
    if pending is not None:
        if pending.get("specHash") == request["specHash"] and target["current"].is_dir() and target["state"].is_file():
            try:
                verify(request)
                authorize_relay(request)
                write_transaction(target, request, "applied", bool(pending.get("previousExisted")))
                emit("apply", "applied", "The interrupted worker operation was recovered and awaits finalization.")
                return "applied"
            except Exception:
                recover_transaction(request, target, pending)
        else:
            recover_transaction(request, target, pending)
    if target["state"].exists():
        try:
            existing = json.loads(target["state"].read_text("utf-8"))
            if existing.get("specHash") == request["specHash"]:
                verify(request)
                authorize_relay(request)
                emit("apply", "unchanged", "The requested worker specification is already healthy.")
                return "unchanged"
        except (OSError, json.JSONDecodeError, ProvisionError):
            pass

    source = safe_bundle_directory()
    staged = target["root"] / f"stage-{uuid.uuid4().hex}"
    shutil.copytree(source, staged, ignore=shutil.ignore_patterns("node_modules", "dist", "coverage", "tests", "*.log"))
    write_environment(staged, request)
    previous_existed = target["current"].exists()
    write_transaction(target, request, "prepared", previous_existed, staged)
    if target["previous"].exists():
        shutil.rmtree(target["previous"])
    if target["previousState"].exists():
        target["previousState"].unlink()
    if previous_existed:
        if target["state"].is_file():
            shutil.copy2(target["state"], target["previousState"])
        os.replace(target["current"], target["previous"])
    os.replace(staged, target["current"])
    write_transaction(target, request, "swapped", previous_existed)
    try:
        emit("apply", "running", "Building and starting only the label-owned worker project.")
        compose(request, target["current"], "up", "--detach", "--build", "--wait", timeout=1800)
        authorize_relay(request)
        atomic_state(target["state"], {
            "version": SCHEMA_VERSION,
            "hostId": request["hostId"],
            "workerPort": request["workerPort"],
            "specHash": request["specHash"],
            "updatedAt": int(time.time() * 1000),
        })
        verify(request)
        write_transaction(target, request, "applied", previous_existed)
        emit("apply", "applied", "The managed worker specification was applied and verified; finalization is pending.")
        return "applied"
    except Exception:
        try:
            compose(request, target["current"], "down", *(('--volumes',) if not previous_existed else ()), timeout=300)
        except Exception:
            pass
        if target["current"].exists():
            shutil.rmtree(target["current"])
        if target["previous"].exists():
            os.replace(target["previous"], target["current"])
            if target["previousState"].is_file():
                os.replace(target["previousState"], target["state"])
            try:
                compose(request, target["current"], "up", "--detach", "--build", "--wait", timeout=1800)
            except Exception:
                pass
        else:
            target["state"].unlink(missing_ok=True)
        clear_transaction(target)
        raise


def rollback(request: dict[str, object]) -> None:
    target = paths(str(request["hostId"]))
    pending = read_transaction(target)
    if pending is not None:
        recover_transaction(request, target, pending)
        emit("rollback", "recovered", "The interrupted managed worker operation was rolled back safely.")
        return
    # A lost finalize response must not make the caller destroy an install
    # that already committed.  With no journal/previous directory left, an
    # exact current spec is proof that finalize completed remotely.
    if target["current"].is_dir() and target["state"].is_file():
        try:
            state = json.loads(target["state"].read_text("utf-8"))
            if state.get("specHash") == request["specHash"]:
                emit("rollback", "already-finalized", "The requested worker specification was already finalized; no rollback was needed.")
                return
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass
    if not target["previous"].is_dir():
        if target["current"].is_dir():
            try:
                compose(request, target["current"], "down", "--volumes", timeout=300)
            finally:
                shutil.rmtree(target["current"], ignore_errors=True)
        remove_relay(str(request["hostId"]))
        target["state"].unlink(missing_ok=True)
        clear_transaction(target)
        emit("rollback", "removed", "The failed first-install worker resources were removed.")
        return
    if target["current"].exists():
        compose(request, target["current"], "down", timeout=300)
        failed = target["root"] / f"failed-{uuid.uuid4().hex}"
        os.replace(target["current"], failed)
    else:
        failed = None
    # Keep the persistent worker-state volume while rolling an upgrade back:
    # it contains the pinned host key that makes the previous install the
    # same worker.  First-install rollback above is the only path allowed to
    # remove volumes.
    os.replace(target["previous"], target["current"])
    if target["previousState"].is_file():
        os.replace(target["previousState"], target["state"])
    compose(request, target["current"], "up", "--detach", "--build", "--wait", timeout=1800)
    if failed and failed.exists():
        shutil.rmtree(failed)
    clear_transaction(target)
    emit("rollback", "applied", "The previous label-owned worker specification was restored.")


def finalize(request: dict[str, object]) -> None:
    target = paths(str(request["hostId"]))
    if not target["current"].is_dir() or not target["state"].is_file():
        raise ProvisionError("No applied worker specification is available to finalize")
    state = json.loads(target["state"].read_text("utf-8"))
    if state.get("specHash") != request["specHash"]:
        raise ProvisionError("The applied worker specification does not match finalization")
    if target["previous"].exists():
        shutil.rmtree(target["previous"])
    target["previousState"].unlink(missing_ok=True)
    clear_transaction(target)
    emit("finalize", "finalized", "The verified worker specification is now the active durable version.")


def remove(request: dict[str, object]) -> None:
    host_id = str(request["hostId"])
    target = paths(host_id)
    # Keep a tiny app-owned removal entry point outside the versioned worker
    # root.  If the process dies after the root is removed but before the
    # caller commits its inventory update, a retry can still prove idempotent
    # absence instead of depending on a script that was just deleted.
    removal_parent = (Path.home() / ".local" / "share" / "material-download-manager" / "ssh-worker").resolve()
    removal_parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    removal_script = removal_parent / f"{host_id}.remove.py"
    temporary = removal_script.with_name(f"{removal_script.name}.{uuid.uuid4().hex}.tmp")
    shutil.copy2(Path(__file__).resolve(), temporary)
    os.chmod(temporary, 0o700)
    os.replace(temporary, removal_script)
    if target["current"].is_dir():
        compose(request, target["current"], "down", "--volumes", timeout=300)
    remove_relay(host_id)
    if target["root"].exists():
        shutil.rmtree(target["root"])
    emit("remove", "removed", "Only the selected host's label-owned worker resources were removed.")


def cleanup(request: dict[str, object]) -> None:
    raw = request.get("stagingDirectory")
    if not isinstance(raw, str) or len(raw) > 4096:
        raise ProvisionError("Staging directory is invalid")
    candidate = Path(raw).resolve()
    parent = (Path.home() / ".local" / "share" / "material-download-manager" / "staging").resolve()
    if candidate.parent != parent or not candidate.name.startswith("operation-"):
        raise ProvisionError("Staging directory escaped its managed parent")
    shutil.rmtree(candidate, ignore_errors=True)
    emit("cleanup", "removed", "The operation staging directory was removed.")


def main() -> int:
    os.umask(0o077)
    action = sys.argv[1] if len(sys.argv) == 2 else ""
    if action not in {"preflight", "apply", "verify", "rollback", "finalize", "remove", "cleanup"}:
        raise ProvisionError("Expected one fixed provisioner action")
    request = exact_request(read_request(), action)
    if action == "cleanup":
        cleanup(request)
        return 0
    target = paths(str(request["hostId"]))
    target["root"].mkdir(mode=0o700, parents=True, exist_ok=True)
    with target["lock"].open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if action == "preflight":
            preflight(request)
        elif action == "apply":
            preflight(request)
            apply(request)
        elif action == "verify":
            verify(request)
        elif action == "rollback":
            rollback(request)
        elif action == "finalize":
            finalize(request)
        elif action == "remove":
            remove(request)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ProvisionError as error:
        emit("operation", "failed", str(error))
        raise SystemExit(1)
    except Exception:
        emit("operation", "failed", "The managed worker operation failed safely.")
        raise SystemExit(1)
