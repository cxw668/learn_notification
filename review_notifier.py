import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


DEFAULT_PROMPT_TEMPLATE = (
    "你是一个复习提醒助手。用户当前的学习目标是：{learning_goal}。\n"
    "今天到了定期复习时间。请直接输出一份简洁的复习清单，格式要求如下：\n"
    "1. 只能输出无序列表，每行以 - 开头。\n"
    "2. 不要写开场白、解释、总结。\n"
    "3. 优先安排概念回顾、基础练习和一个小复盘动作。"
)

CONFIG_PATH = Path(__file__).with_name("review_jobs.json")


def get_today() -> date:
    timezone_name = os.environ.get("REVIEW_TIMEZONE", "Asia/Shanghai")

    if ZoneInfo is not None:
        try:
            current_time = datetime.now(ZoneInfo(timezone_name))
            return current_time.date()
        except Exception:
            pass

    fallback_time = datetime.now(timezone(timedelta(hours=8)))
    return fallback_time.date()


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"未找到配置文件: {path}")

    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    jobs = data.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("配置文件里的 jobs 必须是数组")

    return data


def resolve_secret(job: dict[str, Any], value_key: str, env_key_name: str) -> str:
    direct_value = job.get(value_key)
    if direct_value:
        return str(direct_value)

    env_name = job.get(env_key_name)
    if not env_name:
        raise ValueError(f"任务 {job.get('name', '<unknown>')} 缺少 {value_key} 或 {env_key_name}")

    env_value = os.environ.get(str(env_name))
    if not env_value:
        raise ValueError(f"环境变量 {env_name} 未设置")

    return env_value


def parse_day(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def build_learning_goal(job: dict[str, Any]) -> str:
    template = job.get("review_prompt_template") or DEFAULT_PROMPT_TEMPLATE
    return str(template).format(
        learning_goal=job["learning_goal"],
        review_focus=job.get("review_focus", ""),
    )


def should_run(job: dict[str, Any], today: date) -> bool:
    if job.get("enabled") is False:
        return False

    next_review_date = parse_day(job["next_review_date"])
    return next_review_date <= today


def call_dify(job: dict[str, Any]) -> dict[str, Any]:
    base_url = str(job["dify_base_url"]).rstrip("/")
    api_key = resolve_secret(job, "api_key", "api_key_env")
    email_code = resolve_secret(job, "email_code", "email_code_env")

    inputs = {
        "learning_goal": build_learning_goal(job),
        "email_address": job["email_address"],
        "email_code": email_code,
    }
    extra_inputs = job.get("extra_inputs") or {}
    if not isinstance(extra_inputs, dict):
        raise ValueError("extra_inputs 必须是对象")
    inputs.update(extra_inputs)

    payload = {
        "inputs": inputs,
        "response_mode": "blocking",
        "user": job.get("user_id") or job["name"],
    }

    req = request.Request(
        url=f"{base_url}/workflows/run",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=90) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Dify API 请求失败，HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"无法连接到 Dify: {exc.reason}") from exc

    result = json.loads(body)
    run_data = result.get("data") or {}
    status = run_data.get("status")
    if status and status != "succeeded":
        raise RuntimeError(f"工作流执行失败: {json.dumps(result, ensure_ascii=False)}")

    return result


def save_config(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def run_jobs(config_path: Path) -> int:
    config = load_config(config_path)
    jobs = config["jobs"]
    today = get_today()
    ran_count = 0

    for job in jobs:
        if not should_run(job, today):
            print(f"[skip] {job['name']} 下次执行时间: {job['next_review_date']}")
            continue

        print(f"[run] {job['name']} 开始调用 Dify")
        result = call_dify(job)
        interval_days = int(job.get("interval_days", 3))
        job["last_sent_date"] = today.isoformat()
        job["next_review_date"] = (today + timedelta(days=interval_days)).isoformat()
        job["last_result"] = {
            "workflow_run_id": result.get("workflow_run_id") or (result.get("data") or {}).get("id", ""),
            "status": (result.get("data") or {}).get("status", "succeeded"),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
        ran_count += 1

    save_config(config_path, config)
    print(f"本次执行完成，共触发 {ran_count} 个复习任务")
    return 0


def main() -> int:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else CONFIG_PATH
    try:
        return run_jobs(config_path)
    except Exception as exc:
        print(f"执行失败: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())