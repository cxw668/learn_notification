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
    "3. 优先安排概念回顾、基础练习和一个小复盘动作。\n"
    "4. 上一次复习内容：{previous_review_content}\n"
    "5. 当前学习进度：{learning_progress}"
)

CONFIG_PATH = Path(__file__).with_name("review_jobs.json")
STATE_PATH = Path(__file__).with_name("review_state.json")
HISTORY_PATH = Path(__file__).with_name("review_history.md")


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


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"jobs": {}}

    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    jobs = data.get("jobs")
    if not isinstance(jobs, dict):
        raise ValueError("状态文件里的 jobs 必须是对象")

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


def normalize_text(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def ensure_state_entry(state: dict[str, Any], job_name: str) -> dict[str, Any]:
    jobs = state.setdefault("jobs", {})
    entry = jobs.setdefault(job_name, {})
    if not isinstance(entry.get("history"), list):
        entry["history"] = []
    if not isinstance(entry.get("learning_progress"), str):
        entry["learning_progress"] = ""
    return entry


def build_review_prompt(job: dict[str, Any], state_entry: dict[str, Any]) -> str:
    template = job.get("review_prompt_template") or DEFAULT_PROMPT_TEMPLATE
    learning_goal = normalize_text(job.get("learning_goal"), "当前学习目标")
    previous_review_content = normalize_text(state_entry.get("last_review_content"), "暂无记录")
    learning_progress = normalize_text(state_entry.get("learning_progress"), "暂无进度记录")
    rendered_prompt = str(template).format(
        learning_goal=learning_goal,
        review_focus=job.get("review_focus", ""),
        previous_review_content=previous_review_content,
        learning_progress=learning_progress,
        last_review_date=state_entry.get("last_sent_date", "暂无记录"),
    )
    return normalize_text(
        rendered_prompt,
        f"当前学习目标是：{learning_goal}。请直接输出一份复习清单，仅输出无序列表。",
    )


def build_email_subject(job: dict[str, Any], today: date, state_entry: dict[str, Any]) -> str:
    template = job.get("email_subject_template") or "{learning_goal} 复习提醒"
    review_count = int(state_entry.get("review_count") or 0) + 1
    learning_goal = normalize_text(job.get("learning_goal"), "学习任务")
    rendered_subject = str(template).format(
        learning_goal=learning_goal,
        date=today.isoformat(),
        review_count=review_count,
    )
    return normalize_text(rendered_subject, f"{learning_goal} 复习提醒")


def should_run(job: dict[str, Any], today: date) -> bool:
    if job.get("enabled") is False:
        return False

    next_review_date = parse_day(job["next_review_date"])
    return next_review_date <= today


def call_dify(job: dict[str, Any], today: date, state_entry: dict[str, Any]) -> dict[str, Any]:
    base_url = str(job["dify_base_url"]).rstrip("/")
    api_key = resolve_secret(job, "api_key", "api_key_env")
    email_code = resolve_secret(job, "email_code", "email_code_env")
    user_agent = os.environ.get("DIFY_USER_AGENT", "review-notifier/1.0 (+https://github.com/actions)")
    review_prompt = build_review_prompt(job, state_entry)
    email_subject = build_email_subject(job, today, state_entry)
    previous_review_content = normalize_text(state_entry.get("last_review_content"))
    learning_progress = normalize_text(state_entry.get("learning_progress"))

    inputs = {
        "learning_goal": normalize_text(job.get("learning_goal"), "当前学习目标"),
        "review_prompt": review_prompt,
        "email_subject": email_subject,
        "previous_review_content": previous_review_content,
        "learning_progress": learning_progress,
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
            "Accept": "application/json",
            "User-Agent": user_agent,
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=90) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Dify API 请求失败，HTTP {exc.code}，URL={base_url}/workflows/run，响应={detail}"
        ) from exc
    except error.URLError as exc:
        raise RuntimeError(f"无法连接到 Dify: {exc.reason}") from exc

    result = json.loads(body)
    run_data = result.get("data") or {}
    status = run_data.get("status")
    if status and status != "succeeded":
        raise RuntimeError(f"工作流执行失败: {json.dumps(result, ensure_ascii=False)}")

    return result


def extract_review_content(job: dict[str, Any], result: dict[str, Any]) -> str:
    outputs = (result.get("data") or {}).get("outputs") or {}
    candidates: list[str] = []
    configured_key = job.get("content_output_key")
    if configured_key:
        candidates.append(str(configured_key))
    candidates.extend(["content", "text", "result"])

    for key in candidates:
        value = outputs.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    for value in outputs.values():
        if isinstance(value, str) and value.strip():
            return value.strip()

    return ""


def save_state(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def render_history(state: dict[str, Any], config: dict[str, Any]) -> str:
    lines = ["# 复习记录", ""]
    jobs_config = {job["name"]: job for job in config.get("jobs", []) if isinstance(job, dict) and job.get("name")}

    for job_name, entry in sorted((state.get("jobs") or {}).items()):
        learning_goal = jobs_config.get(job_name, {}).get("learning_goal", job_name)
        lines.append(f"## {learning_goal}")
        lines.append("")
        lines.append(f"- 任务名：{job_name}")
        lines.append(f"- 最近发送：{entry.get('last_sent_date', '暂无记录')}")
        lines.append(f"- 学习进度：{entry.get('learning_progress') or '暂无记录'}")
        lines.append("")

        history = entry.get("history") or []
        if not history:
            lines.append("暂无复习记录。")
            lines.append("")
            continue

        for item in reversed(history):
            lines.append(f"### {item.get('sent_at', '未知时间')} | {item.get('subject', '复习提醒')}")
            lines.append("")
            content = str(item.get("content") or "").strip()
            lines.append(content or "未保存到复习内容。")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def save_history(path: Path, state: dict[str, Any], config: dict[str, Any]) -> None:
    history_text = render_history(state, config)
    with path.open("w", encoding="utf-8") as handle:
        handle.write(history_text)


def save_config(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def run_jobs(config_path: Path) -> int:
    config = load_config(config_path)
    state = load_state(STATE_PATH)
    jobs = config["jobs"]
    today = get_today()
    ran_count = 0

    for job in jobs:
        state_entry = ensure_state_entry(state, job["name"])
        if not should_run(job, today):
            print(f"[skip] {job['name']} 下次执行时间: {job['next_review_date']}")
            continue

        print(f"[run] {job['name']} 开始调用 Dify")
        result = call_dify(job, today, state_entry)
        review_content = extract_review_content(job, result)
        interval_days = int(job.get("interval_days", 3))
        email_subject = build_email_subject(job, today, state_entry)
        job["last_sent_date"] = today.isoformat()
        job["next_review_date"] = (today + timedelta(days=interval_days)).isoformat()
        job["last_result"] = {
            "workflow_run_id": result.get("workflow_run_id") or (result.get("data") or {}).get("id", ""),
            "status": (result.get("data") or {}).get("status", "succeeded"),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
        state_entry["last_sent_date"] = today.isoformat()
        state_entry["last_email_subject"] = email_subject
        state_entry["last_review_content"] = review_content
        state_entry["review_count"] = int(state_entry.get("review_count") or 0) + 1
        history_limit = int(job.get("history_limit", 20))
        history = state_entry.get("history") or []
        history.append(
            {
                "sent_at": today.isoformat(),
                "subject": email_subject,
                "content": review_content,
                "workflow_run_id": result.get("workflow_run_id") or (result.get("data") or {}).get("id", ""),
            }
        )
        state_entry["history"] = history[-history_limit:]
        ran_count += 1

    save_config(config_path, config)
    save_state(STATE_PATH, state)
    save_history(HISTORY_PATH, state, config)
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