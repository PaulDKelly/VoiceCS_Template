import os
import json
import sqlite3
import importlib
from typing import Optional, Dict, Any
from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion
import re

def _is_valid_name(value: str) -> bool:
    if not value:
        return False
    cleaned = value.strip()
    if len(cleaned) < 2:
        return False
    if cleaned.isdigit():
        return False
    if not re.search(r"[A-Za-z]", cleaned):
        return False
    banned = {
        "there", "here", "someone", "anyone", "unknown",
        "yes", "yeah", "yep", "okay", "ok", "sure",
        "mate", "buddy", "pal", "friend", "sir", "madam",
        "oh", "uh", "um", "erm", "hmm", "mm", "mmm"
    }
    if cleaned.lower() in banned:
        return False
    return True

def handle_generic_workflow(session_id: str, text: str) -> dict:
    session = load_session(session_id)
    config = load_merged_config(session.get("client_id"), session.get("industry"))
    
    # Track text for actions that need it (e.g. name extraction)
    if text:
        session["_last_user_input"] = text
    
    intent = session.get("intent", "general")
    workflow = config.get("workflows", {}).get(intent)
    
    if not workflow:
        from shared_code.workflows.general_engine import handle_general
        return handle_general(session_id, text)

    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])
    
    current_node_id = session.get("current_node_id")
    
    # 1. Start logic
    if not current_node_id:
        # Find start node (usually type 'input' or no incoming edges, or just pick first one if none)
        start_node = next((n for n in nodes if n.get("type") == "input"), None)
        if not start_node:
            start_node = nodes[0] if nodes else None
        
        if not start_node:
            return {"prompt": "I'm sorry, I'm having trouble starting this workflow.", "session": session, "config": config}
        
        current_node_id = start_node["id"]
        # Skip straight to prompt generation for start node
        session["current_node_id"] = current_node_id
        save_session(session_id, session)
        return _process_node(current_node_id, nodes, edges, session, config, session_id)

    # 2. Step Traversal (we were already at a node, now processing user response)
    current_node = next((n for n in nodes if n["id"] == current_node_id), None)
    if not current_node:
        session["current_node_id"] = None # Reset
        save_session(session_id, session)
        return handle_generic_workflow(session_id, text)

    # 3. Capture Logic
    capture_var = current_node.get("data", {}).get("captureVariable")
    if capture_var and text:
        captured = text.strip()
        if capture_var == "customer_name":
            if _is_valid_name(captured):
                session[capture_var] = captured
                session.pop("_name_retry", None)
                print(f"DEBUG: Captured '{text}' into variable '{capture_var}'", flush=True)
            else:
                retries = int(session.get("_name_retry") or 0)
                if retries < 1:
                    session["_name_retry"] = retries + 1
                    save_session(session_id, session)
                    return {
                        "prompt": "Sorry, I didn’t catch your name — could you repeat it?",
                        "session": session,
                        "config": config,
                    }
                # Give up on name after one retry, proceed without it
                session.pop("customer_name", None)
                session.pop("_name_retry", None)
                print(f"DEBUG: Invalid name '{text}' after retry; proceeding without name.", flush=True)
        else:
            session[capture_var] = captured
            print(f"DEBUG: Captured '{text}' into variable '{capture_var}'", flush=True)

    # 4. Decide Next Node
    outgoing_edges = [e for e in edges if e["source"] == current_node_id]
    
    if not outgoing_edges:
        # Check if it's a handoff node (though handoff node usually jumps workflow)
        if current_node.get("type") == "handoff":
            target = current_node.get("data", {}).get("targetWorkflow")
            if target:
                session["intent"] = target
                session["current_node_id"] = None
                save_session(session_id, session)
                from shared_code.agent.workflow_router import route_to_workflow
                return route_to_workflow(target, session_id, text)
        
        return {"prompt": "Thank you for that information. Is there anything else I can help with?", "session": session, "config": config}

    next_node_id = _decide_next_node(text, outgoing_edges, nodes, session, config)
    
    if not next_node_id:
        return {"prompt": "I'm not sure I understood. Could you elaborate?", "session": session, "config": config}

    session["current_node_id"] = next_node_id
    save_session(session_id, session)
    
    return _process_node(next_node_id, nodes, edges, session, config, session_id)

def _process_node(node_id: str, nodes: list, edges: list, session: dict, config: dict, session_id: str) -> dict:
    node = next((n for n in nodes if n["id"] == node_id), None)
    if not node:
         return {"prompt": "Workflow Error: Node not found.", "session": session, "config": config}

    # 1. Handoff Execution
    if node.get("type") == "handoff":
        target = node.get("data", {}).get("targetWorkflow")
        if target:
            session["intent"] = target
            session["current_node_id"] = None
            save_session(session_id, session)
            from shared_code.agent.workflow_router import route_to_workflow
            return route_to_workflow(target, session_id, "")

    # 2. Action Execution
    if node.get("type") == "action":
        action_result = _execute_action(node, session, config)
        if action_result:
            if action_result.get("prompt"):
                # If a direct prompt is returned, stop traversal and reply immediately
                session["current_node_id"] = None
                save_session(session_id, session)
                return {"prompt": action_result["prompt"], "session": session, "config": config}

            if action_result.get("handoff_intent"):
                target_intent = action_result["handoff_intent"]
                session["intent"] = target_intent
                session["current_node_id"] = None
                save_session(session_id, session)
                from shared_code.agent.workflow_router import route_to_workflow
                last_text = session.get("_last_user_input", "") or ""
                result = route_to_workflow(target_intent, session_id, last_text)
                result["handoff_complete"] = True
                return result
        # Actions are transparent to the user, move to next node immediately
        outgoing = [e for e in edges if e["source"] == node_id]
        if outgoing:
            next_id = outgoing[0]["target"]
            session["current_node_id"] = next_id
            save_session(session_id, session)
            return _process_node(next_id, nodes, edges, session, config, session_id)
        else:
            return {"prompt": "I've processed your request. Is there anything else? [HANGUP]", "session": session, "config": config}

    # 2. Generate Prompt
    data = node.get("data", {}) or {}
    prompt_key = data.get("promptKey")
    prompt_key_with_name = data.get("promptKeyWithName")
    name_val = session.get("customer_name") or session.get("name")
    if (
        prompt_key_with_name
        and config.get("enable_caller_memory")
        and isinstance(name_val, str)
        and _is_valid_name(name_val)
    ):
        prompt_key = prompt_key_with_name
    if prompt_key:
        prompt = config.get("prompts", {}).get(prompt_key, f"Missing prompt: {prompt_key}")
    else:
        prompt = node.get("data", {}).get("label", "Next step...")

    # Resolve variables in prompt
    def replace_var(match):
        var_name = match.group(1)

        # Common aliases
        if var_name == "assistant":
            return str(
                session.get("assistant")
                or config.get("assistant_name")
                or config.get("agent_name")
                or "agent"
            )
        if var_name == "brand":
            return str(
                session.get("brand")
                or config.get("brand_name")
                or config.get("default_brand_name")
                or "brand"
            )
        if var_name == "name":
            name_val = session.get("customer_name") or session.get("name")
            if isinstance(name_val, str):
                cleaned = name_val.strip()
                banned = {
                    "there", "here", "someone", "anyone", "unknown",
                    "yes", "yeah", "yep", "okay", "ok", "sure",
                    "mate", "buddy", "pal", "friend", "sir", "madam"
                }
                if cleaned and cleaned.lower() not in banned:
                    return cleaned
            return ""
        if var_name == "caller_memory":
            return str(session.get("caller_memory") or "")

        # Default: session first, then config
        return str(
            session.get(var_name)
            or config.get(var_name)
            or f"[{var_name}]"
        )

    prompt = re.sub(r"\{(\w+)\}", replace_var, prompt)
    # Clean up punctuation/spacing if {name} was empty
    prompt = re.sub(r",\s*([?.!])", r"\1", prompt)
    prompt = re.sub(r"\s+([?.!])", r"\1", prompt)
    prompt = re.sub(r"\s{2,}", " ", prompt).strip()

    return {"prompt": prompt, "session": session, "config": config}

def _decide_next_node(text: str, edges: list, nodes: list, session: dict, config: dict) -> Optional[str]:
    if len(edges) == 1:
        return edges[0]["target"]
    
    # Branching logic
    options = []
    for e in edges:
        label = e.get("label", "Continue")
        options.append(f"NodeID: {e['target']}, Logic: {label}")
    
    system_prompt = (
        "Based on the user input, decide which workflow path to take. "
        "User said: " + text + "\n"
        "Options:\n" + "\n".join(options) + "\n"
        "Return ONLY the NodeID of the best match. No explanation."
    )
    
    response = chat_completion([{"role": "system", "content": system_prompt}])
    best_id = response.strip()
    
    # Validate against actual edges
    if any(e["target"] == best_id for e in edges):
        return best_id
    
    return edges[0]["target"] # Default fallback

def _execute_action(node: dict, session: dict, config: dict):
    data = node.get("data", {})
    action_type = data.get("actionType")
    action_config = data.get("actionConfig", {})
    
    # Import locally to avoid circular dependencies
    from shared_code.utils.session import save_session

    print(f"DEBUG: Executing Action '{action_type}'", flush=True)

    if action_type == 'email':
        from shared_code.utils.email_client import send_generic_email
        to = action_config.get("to")
        subject = action_config.get("subject", "Workflow Update")
        body = f"Workflow Action Triggered.\nSession Data: {json.dumps(session, indent=2)}"
        send_generic_email(to, subject, body)

    elif action_type == 'sms':
        print(f"SMS TODO: Send to {action_config.get('phone')}", flush=True)

    elif action_type == 'webhook':
        import requests
        url = action_config.get("url")
        if url:
            try:
                requests.post(url, json=session, timeout=5)
            except Exception as e:
                print(f"ERROR: Webhook failed: {e}", flush=True)

    elif action_type == 'whisper':
        import requests
        account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        if not account_sid or not auth_token:
            print("WARN: Whisper action skipped (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing).", flush=True)
            return None

        target_number = action_config.get("target_number") or config.get("whisper_target_number")
        if not target_number:
            print("WARN: Whisper action skipped (target number missing).", flush=True)
            return None

        from_number = session.get("called_number") or os.getenv("TWILIO_FROM_NUMBER")
        if not from_number:
            print("WARN: Whisper action skipped (from number missing).", flush=True)
            return None

        message = action_config.get("message") or "Calling to provide an update from the voice assistant."
        # Basic template replacement from session/config
        for key, val in {
            "assistant": config.get("assistant_name") or config.get("agent_name") or "agent",
            "brand": config.get("brand_name") or config.get("default_brand_name") or "brand",
            "name": session.get("customer_name") or "",
            "phone": session.get("phone_number") or "",
        }.items():
            message = message.replace(f"{{{key}}}", str(val))

        twiml = f"<Response><Say voice=\"Polly.Amy\">{message}</Say></Response>"
        try:
            requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Calls.json",
                auth=(account_sid, auth_token),
                data={"To": target_number, "From": from_number, "Twiml": twiml},
                timeout=10,
            )
            print(f"DEBUG: Whisper call placed to {target_number} from {from_number}", flush=True)
        except Exception as e:
            print(f"ERROR: Whisper action failed: {e}", flush=True)

    elif action_type == 'extract_name':
        # Reuse logic from agent_engine
        from shared_code.agent.agent_engine import _extract_name_smartly
        # We need the user's last text. 
        # In generic_engine, 'text' is passed to handle_generic_workflow. 
        # We need to make sure _execute_action can access it if needed, 
        # but usually actions process what was just captured.
        last_text = session.get("_last_user_input", "")
        name = _extract_name_smartly(last_text)
        if name and _is_valid_name(name):
            session["customer_name"] = name
            session.pop("_name_retry", None)
            print(f"DEBUG: ExtractName action found: {name}", flush=True)
        elif name:
            print(f"DEBUG: ExtractName action discarded invalid name: {name}", flush=True)

    elif action_type == 'detect_intent':
        fixed_intent = action_config.get("fixed_intent") or action_config.get("target_intent")
        if fixed_intent:
            print(f"DEBUG: DetectIntent action using fixed intent: {fixed_intent}.", flush=True)
            return {"handoff_intent": fixed_intent}

        from shared_code.routing.intent_router import detect_intent
        last_text = session.get("_last_user_input", "")
        # Use keyword-only routing for deterministic workflow handoff
        intent = detect_intent(last_text, session.get("client_id"), session.get("industry"), allow_llm=False)
        if not intent:
            # No intent matched: provide a polite fallback prompt
            fallback = (
                config.get("prompts", {}).get("intent_not_recognized")
                or "Sorry, I’m not able to help with that. Is there anything else I can assist you with?"
            )
            print("DEBUG: DetectIntent action found no intent. Using fallback prompt.", flush=True)
            return {"prompt": fallback}
        print(f"DEBUG: DetectIntent action found: {intent}. Switching workflow.", flush=True)
        return {"handoff_intent": intent}

    elif action_type == 'database_query':
        return _execute_database_query(action_config, session, config)

    elif action_type == 'update_session':
        updates = action_config.get("updates", {})
        for k, v in updates.items():
            session[k] = v
            print(f"DEBUG: SessionUpdate {k}={v}", flush=True)


def _resolve_action_connection(action_config: dict, config: dict) -> tuple[dict, str]:
    connections = config.get("database_connections") or {}
    conn_ref = action_config.get("connection_ref")
    base = {}
    if conn_ref and isinstance(connections, dict):
        candidate = connections.get(conn_ref)
        if isinstance(candidate, dict):
            base = candidate

    merged = dict(base)
    for field in [
        "type", "host", "port", "database", "username", "password", "password_env",
        "connection_string", "sqlite_path"
    ]:
        if action_config.get(field) not in (None, ""):
            merged[field] = action_config.get(field)

    db_type = str(
        merged.get("type")
        or action_config.get("database_type")
        or "custom"
    ).strip().lower()
    return merged, db_type


def _build_query_and_params(query_template: str, db_type: str, session: dict, config: dict):
    placeholder = "%s" if db_type in ("postgres", "mysql") else "?"

    names = re.findall(r"\{(\w+)\}", query_template or "")
    params = []
    query = query_template
    for name in names:
        value = session.get(name, config.get(name))
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        params.append(value)
        query = query.replace("{" + name + "}", placeholder, 1)

    return query, params


def _rows_to_dicts(cursor, rows):
    if not cursor.description:
        return []
    cols = [d[0] for d in cursor.description]
    out = []
    for row in rows:
        out.append({cols[i]: row[i] for i in range(min(len(cols), len(row)))})
    return out


def _connect_db(conn_cfg: dict, db_type: str, timeout_seconds: float):
    password = conn_cfg.get("password")
    if not password and conn_cfg.get("password_env"):
        password = os.getenv(str(conn_cfg.get("password_env")))

    if db_type == "sqlite":
        sqlite_path = conn_cfg.get("sqlite_path") or conn_cfg.get("database") or conn_cfg.get("connection_string")
        if not sqlite_path:
            raise RuntimeError("SQLite requires sqlite_path (or database/connection_string).")
        conn = sqlite3.connect(sqlite_path, timeout=timeout_seconds)
        return conn, "sqlite"

    if db_type == "postgres":
        try:
            psycopg2 = importlib.import_module("psycopg2")
        except Exception:
            raise RuntimeError("PostgreSQL driver not installed (psycopg2).")
        kwargs = {
            "host": conn_cfg.get("host"),
            "port": int(conn_cfg.get("port")) if conn_cfg.get("port") else 5432,
            "dbname": conn_cfg.get("database"),
            "user": conn_cfg.get("username"),
            "password": password,
            "connect_timeout": int(timeout_seconds),
        }
        if conn_cfg.get("connection_string"):
            return psycopg2.connect(conn_cfg.get("connection_string"), connect_timeout=int(timeout_seconds)), "postgres"
        return psycopg2.connect(**kwargs), "postgres"

    if db_type == "mysql":
        try:
            pymysql = importlib.import_module("pymysql")
        except Exception:
            raise RuntimeError("MySQL driver not installed (pymysql).")
        kwargs = {
            "host": conn_cfg.get("host"),
            "port": int(conn_cfg.get("port")) if conn_cfg.get("port") else 3306,
            "database": conn_cfg.get("database"),
            "user": conn_cfg.get("username"),
            "password": password,
            "connect_timeout": int(timeout_seconds),
            "read_timeout": int(timeout_seconds),
            "write_timeout": int(timeout_seconds),
            "charset": "utf8mb4",
            "autocommit": True,
        }
        if conn_cfg.get("connection_string"):
            raise RuntimeError("MySQL connection_string is not supported in this adapter. Use host/port/database/username/password.")
        return pymysql.connect(**kwargs), "mysql"

    # sqlserver + custom are routed to pyodbc with connection string.
    try:
        pyodbc = importlib.import_module("pyodbc")
    except Exception:
        raise RuntimeError("ODBC driver not installed (pyodbc) for SQL Server/Custom connections.")

    connection_string = conn_cfg.get("connection_string")
    if not connection_string and db_type == "sqlserver":
        host = conn_cfg.get("host") or ""
        database = conn_cfg.get("database") or ""
        username = conn_cfg.get("username") or ""
        driver = conn_cfg.get("driver") or "ODBC Driver 18 for SQL Server"
        if host and database and username and password:
            connection_string = (
                f"DRIVER={{{driver}}};SERVER={host};DATABASE={database};"
                f"UID={username};PWD={password};Encrypt=yes;TrustServerCertificate=yes;"
            )
    if not connection_string:
        raise RuntimeError("Custom/SQL Server connection requires connection_string.")

    return pyodbc.connect(connection_string, timeout=int(timeout_seconds)), "odbc"


def _execute_database_query(action_config: dict, session: dict, config: dict):
    conn_cfg, db_type = _resolve_action_connection(action_config, config)
    query_template = action_config.get("query_template") or action_config.get("query")
    if not query_template:
        print("WARN: Database query skipped (query_template missing).", flush=True)
        return None

    max_rows = int(action_config.get("max_rows") or 10)
    timeout_seconds = float(action_config.get("timeout_seconds") or 5)
    single_row = bool(action_config.get("single_row"))
    result_var = action_config.get("result_var") or "db_result"

    try:
        query, params = _build_query_and_params(query_template, db_type, session, config)
        conn, _ = _connect_db(conn_cfg, db_type, timeout_seconds)
        try:
            cur = conn.cursor()
            cur.execute(query, params)
            if cur.description:
                rows = cur.fetchmany(max_rows)
                result_rows = _rows_to_dicts(cur, rows)
                session[result_var] = (result_rows[0] if result_rows else None) if single_row else result_rows
            else:
                try:
                    conn.commit()
                except Exception:
                    pass
                session[result_var] = {"rows_affected": cur.rowcount}
            print(f"DEBUG: Database query stored result in '{result_var}'", flush=True)
        finally:
            try:
                conn.close()
            except Exception:
                pass
        return None
    except Exception as e:
        err_text = f"{type(e).__name__}: {e}"
        session[f"{result_var}_error"] = err_text
        print(f"ERROR: Database query action failed: {err_text}", flush=True)
        if action_config.get("error_prompt"):
            return {"prompt": action_config.get("error_prompt")}
        return None
