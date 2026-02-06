import os
import json
from typing import Optional, Dict, Any
from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion

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
        session[capture_var] = text.strip()
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
                result = route_to_workflow(target_intent, session_id, text)
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
    prompt_key = node.get("data", {}).get("promptKey")
    if prompt_key:
        prompt = config.get("prompts", {}).get(prompt_key, f"Missing prompt: {prompt_key}")
    else:
        prompt = node.get("data", {}).get("label", "Next step...")

    # Resolve variables in prompt
    import re
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
            return str(session.get("customer_name") or session.get("name") or "there")

        # Default: session first, then config
        return str(
            session.get(var_name)
            or config.get(var_name)
            or f"[{var_name}]"
        )

    prompt = re.sub(r"\{(\w+)\}", replace_var, prompt)

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

    elif action_type == 'extract_name':
        # Reuse logic from agent_engine
        from shared_code.agent.agent_engine import _extract_name_smartly
        # We need the user's last text. 
        # In generic_engine, 'text' is passed to handle_generic_workflow. 
        # We need to make sure _execute_action can access it if needed, 
        # but usually actions process what was just captured.
        last_text = session.get("_last_user_input", "")
        name = _extract_name_smartly(last_text)
        if name:
            session["customer_name"] = name
            print(f"DEBUG: ExtractName action found: {name}", flush=True)

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

    elif action_type == 'update_session':
        updates = action_config.get("updates", {})
        for k, v in updates.items():
            session[k] = v
            print(f"DEBUG: SessionUpdate {k}={v}", flush=True)
