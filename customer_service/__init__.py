import logging
import azure.functions as func
import json
import requests
import os
from datetime import datetime, date

from ..config_loader import build_final_prompt, load_workflow_prompt
from ..warranty_utils import parse_purchase_date_from_text, calculate_warranty_status
from ..local_memory import get_customer, update_customer

# -----------------------------
# IN-MEMORY STATE
# -----------------------------
conversation_state = {}  # { call_id: [ {role, content}, ... ] }

workflow_state = {}      # {
                         #   call_id: {
                         #       "phase": "start" | "start_name" | "start_callback" | "start_reason"
                         #                 | "warranty" | "sales" | "service" | "finance",
                         #       "name": str | None,
                         #       "callback_confirmed": bool,
                         #       "intent": str | None,
                         #       "purchase_date": date | None,
                         #       "purchase_location": str | None,
                         #       "registration": str | None,
                         #       "mileage": str | None,
                         #       "previous_repairs": str | None,
                         #       "warranty_in_warranty": bool | None,
                         #       "warranty_expiry_date": date | None
                         #   }
                         # }


# -----------------------------
# AOAI CALL
# -----------------------------
def call_model(messages, endpoint, api_key, deployment):
    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions"
    params = {"api-version": "2024-05-01-preview"}

    headers = {
        "Content-Type": "application/json",
        "api-key": api_key
    }

    body = {
        "messages": messages,
        "temperature": 0.2
    }

    resp = requests.post(url, headers=headers, params=params, json=body, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    return data["choices"][0]["message"]["content"]


# -----------------------------
# WORKFLOW STATE HELPERS
# -----------------------------
def get_or_init_workflow_state(call_id: str) -> dict:
    if call_id not in workflow_state:
        workflow_state[call_id] = {
            "phase": "start",           # start -> start_name -> start_callback -> start_reason -> warranty/sales/finance/service
            "name": None,
            "callback_confirmed": False,
            "intent": None,
            "purchase_date": None,
            "purchase_location": None,
            "registration": None,
            "mileage": None,
            "previous_repairs": None,
            "warranty_in_warranty": None,
            "warranty_expiry_date": None
        }
    return workflow_state[call_id]


def clear_state_for_call(call_id: str):
    if call_id in conversation_state:
        del conversation_state[call_id]
    if call_id in workflow_state:
        del workflow_state[call_id]


# -----------------------------
# WARRANTY HELPERS
# -----------------------------
def update_warranty_status(ws: dict, user_message: str, warranty_months: int, caller_id: str | None = None):
    """
    If the user_message contains a purchase date, compute strict warranty status
    and update workflow state (and local memory if available).
    """
    purchase_date = parse_purchase_date_from_text(user_message)
    if not purchase_date:
        return

    status = calculate_warranty_status(purchase_date, warranty_months)
    ws["purchase_date"] = purchase_date
    ws["warranty_in_warranty"] = status["in_warranty"]
    ws["warranty_expiry_date"] = status["expiry_date"]

    # Persist purchase date in local memory (for local-test-user or real caller_id if desired)
    if caller_id:
        try:
            update_customer(caller_id, {"purchase_date": purchase_date.isoformat()})
        except Exception as e:
            logging.warning(f"Failed to update local memory with purchase_date: {e}")

    logging.info(
        f"[Warranty] purchase_date={purchase_date}, "
        f"in_warranty={status['in_warranty']}, expiry={status['expiry_date']}"
    )


def build_warranty_status_instructions(ws: dict) -> str:
    """
    Build a strict instruction block about warranty status if we have it.
    """
    purchase_date = ws.get("purchase_date")
    expiry_date = ws.get("warranty_expiry_date")
    in_warranty = ws.get("warranty_in_warranty")

    if not purchase_date or not expiry_date or in_warranty is None:
        return ""

    purchase_str = purchase_date.strftime("%d %B %Y")
    expiry_str = expiry_date.strftime("%d %B %Y")

    if in_warranty:
        return (
            f"\n\nWARRANTY STATUS (STRICTLY CALCULATED BY THE SYSTEM): "
            f"The vehicle was purchased on {purchase_str}. "
            f"The warranty period is still ACTIVE and will expire on {expiry_str}. "
            f"You must not say the warranty has expired."
        )
    else:
        return (
            f"\n\nWARRANTY STATUS (STRICTLY CALCULATED BY THE SYSTEM): "
            f"The vehicle was purchased on {purchase_str}. "
            f"The warranty period has EXPIRED. It expired on {expiry_str}. "
            f"You must not say the vehicle is still within the warranty period."
        )


# -----------------------------
# WORKFLOW PROMPT BUILDER
# -----------------------------
def build_system_prompt(client_name: str, ws: dict) -> str:
    """
    Build the system prompt for this turn:
    - Base + routing + brand info (from config_loader.build_final_prompt)
    - Current date/time
    - Active workflow prompt (warranty/sales/service/finance) if any
    - Strict warranty instructions if available
    - Off-topic behaviour rules when in warranty phase
    """
    base_prompt = build_final_prompt(client_name)

    now = datetime.utcnow().strftime("%A, %d %B %Y, %H:%M UTC")
    prompt = (
        base_prompt
        + f"\n\nCurrent date and time: {now}. "
        + "Use this when answering questions about today, now, or scheduling."
    )

    phase = ws.get("phase")

    # Attach workflow-specific prompt
    workflow_prompt = ""
    if phase == "warranty":
        workflow_prompt = load_workflow_prompt("warranty", client_name)
    elif phase == "sales":
        workflow_prompt = load_workflow_prompt("sales", client_name)
    elif phase == "service":
        workflow_prompt = load_workflow_prompt("service", client_name)
    elif phase == "finance":
        workflow_prompt = load_workflow_prompt("finance", client_name)

    if workflow_prompt:
        prompt += "\n\n" + workflow_prompt

    # Strict warranty status (if known)
    if phase == "warranty":
        prompt += build_warranty_status_instructions(ws)

        # Off-topic rule: stay focused during warranty flow
        prompt += (
            "\n\nDuring the warranty enquiry workflow, if the customer asks an unrelated "
            "general question (for example about the current date, who you are, or other "
            "topics), briefly and politely explain that you are currently handling their "
            "warranty enquiry and need to focus on collecting the necessary details. "
            "Offer to answer general questions once the warranty process is complete, "
            "then immediately steer the conversation back to the warranty questions."
        )

    # DEBUG: log final prompt actually sent to the model
    logging.info("SYSTEM PROMPT:\n" + prompt)

    return prompt


# -----------------------------
# INTENT / PHASE HELPERS (OPTION A)
# -----------------------------
def detect_intent_from_user_message(user_message: str) -> str:
    """
    Option A routing:
    - If sales intent → 'sales'
    - If finance intent → 'finance'
    - Everything else → 'warranty'
    """
    text = user_message.lower()

    # Sales always wins
    if any(w in text for w in [
        "buy", "purchase", "new car", "used car", "test drive",
        "sales", "deal", "quote", "price", "availability"
    ]):
        return "sales"

    # Finance always wins
    if any(w in text for w in [
        "finance", "payment", "loan", "apr", "interest",
        "monthly", "credit", "agreement"
    ]):
        return "finance"

    # Everything else → warranty first
    return "warranty"


# -----------------------------
# MAIN FUNCTION
# -----------------------------
def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Dynamic CustomerServicesAgent function triggered.")

    # -------------------------
    # Parse JSON body
    # -------------------------
    try:
        body = req.get_json()
    except Exception:
        return func.HttpResponse("Invalid JSON", status_code=400)

    event_type = body.get("type")
    user_message = ""

    # ---------------------------------------------------------
    # LOCAL TESTING COMPATIBILITY LAYER
    # Allows simple { "text": "..." } messages to behave like ACS events
    # ---------------------------------------------------------
    LOCAL_TEST = False
    if event_type is None:
        # Local test mode: treat plain text as Recognized speech
        LOCAL_TEST = True
        user_message = body.get("text", "").strip()

        # Simulate CallConnected if user indicates start of call
        if user_message.lower() in [
            "the call has started.",
            "call started",
            "start call",
            "begin call",
            "call has started"
        ]:
            logging.info("[LocalTest] Simulated CallConnected")
            event_type = "CallConnected"
            user_message = "The call has started."
        else:
            logging.info(f"[LocalTest] Simulated Recognized: {user_message}")
            event_type = "Recognized"
            body["data"] = {"text": user_message}

    # ---------------------------------------------------------
    # CALLER IDENTIFICATION & CUSTOMER MEMORY
    # ---------------------------------------------------------
    if LOCAL_TEST:
        caller_id = "local-test-user"
    else:
        caller_id = body.get("from", {}).get("rawId", "unknown-caller")

    try:
        customer_memory = get_customer(caller_id)
    except Exception as e:
        logging.warning(f"Failed to load customer memory for {caller_id}: {e}")
        customer_memory = {}

    call_id = body.get("callConnectionId", "test-call")

    # ---------------------------------------------------------
    # NORMAL EVENT HANDLING (works for both ACS + local test)
    # ---------------------------------------------------------
    if event_type == "Recognized":
        user_message = body["data"].get("text", "")
    elif event_type == "CallConnected":
        user_message = "The call has started."
    else:
        user_message = body.get("text", "")

    logging.info(f"User message: {user_message}")

    # Cleanup on hangup (call-state only; customer memory persists)
    if event_type == "Hangup":
        clear_state_for_call(call_id)
        return func.HttpResponse("Call ended.", status_code=200)

    # -------------------------
    # Init state
    # -------------------------
    if call_id not in conversation_state:
        conversation_state[call_id] = []

    ws = get_or_init_workflow_state(call_id)
    phase = ws.get("phase")

    # ---------------------------------------------------------
    # FIXED START-OF-CALL STATE MACHINE
    # ---------------------------------------------------------
    if event_type == "CallConnected":
    # Returning-caller logic: check memory immediately
        if customer_memory.get("name"):
            stored = customer_memory["name"].strip()
            lower = stored.lower()

            prefixes = [
                "my name is",
                "i am",
                "i'm",
                "im",
                "this is",
                "its",
                "it's",
                "you are speaking to",
                "you're speaking to",
                "youre speaking to",
                "speaking to",
                "speaking with",
            ]

            for p in prefixes:
                if lower.startswith(p):
                    stored = stored[len(p):].strip(" .,!:-")
                    break

            if stored.lower().endswith(" here"):
                stored = stored[:-5].strip(" .,!:-")

            ws["name"] = stored
            ws["phase"] = "start_callback"
        else:
            ws["phase"] = "start_name"



    elif phase == "start_name":
        raw = user_message.strip()
        lower = raw.lower()

        # Patterns to strip
        prefixes = [
            "my name is",
            "i am",
            "i'm",
            "im",
            "this is",
            "its",
            "it's",
            "you are speaking to",
            "you're speaking to",
            "youre speaking to",
            "speaking to",
            "speaking with",
            "paul here",  # generic pattern: "<name> here" handled below
        ]

        name_only = raw

        # Remove known prefixes
        for p in prefixes:
            if lower.startswith(p):
                name_only = raw[len(p):].strip(" .,!:-")
                break

        # Handle "<name> here"
        if name_only.lower().endswith(" here"):
            name_only = name_only[:-5].strip(" .,!:-")

        # If the user just said a single word like "Paul"
        # or a multi-word name like "Sarah Jane Smith"
        # we leave it as-is.

        ws["name"] = name_only

        try:
            update_customer(caller_id, {"name": name_only})
        except Exception as e:
            logging.warning(f"Failed to update local memory with name: {e}")

        ws["phase"] = "start_callback"



    elif phase == "start_callback":
        # User just confirmed whether this is the best callback number
        ws["callback_confirmed"] = ("yes" in user_message.lower())
        ws["phase"] = "start_reason"

    elif phase == "start_reason":
        # User just gave the reason for calling → now route directly using Option A
        intent = detect_intent_from_user_message(user_message)
        ws["intent"] = intent
        ws["phase"] = intent  # "warranty", "sales", or "finance"
        logging.info(f"[Routing] Initial intent from reason (Option A): {intent}")

    # ---------------------------------------------------------
    # WARRANTY STRICT CALCULATION
    # ---------------------------------------------------------
    WARRANTY_MONTHS = int(os.getenv("WARRANTY_MONTHS", "6"))
    if ws.get("phase") == "warranty":
        # Heuristic: first user message in warranty phase is likely the registration
        if ws.get("registration") is None and user_message and user_message != "The call has started.":
            # If we already have a registration in memory, confirm it instead of overwriting silently
            if customer_memory.get("registration") and ws.get("registration") is None:
                # Let the model handle the confirmation wording via prompt; we just store state
                ws["registration"] = customer_memory["registration"]
            else:
                ws["registration"] = user_message
                try:
                    update_customer(caller_id, {"registration": user_message})
                except Exception as e:
                    logging.warning(f"Failed to update local memory with registration: {e}")

        update_warranty_status(ws, user_message, WARRANTY_MONTHS, caller_id=caller_id)

    # ---------------------------------------------------------
    # Append user message to conversation history
    # ---------------------------------------------------------
    conversation_state[call_id].append({"role": "user", "content": user_message})

    # ---------------------------------------------------------
    # ASSISTANT RESPONSES FOR START-OF-CALL PHASES
    # ---------------------------------------------------------
    if ws["phase"] == "start_name":
        # If we already know the caller's name, greet them as returning
        if ws.get("name"):
            assistant_reply = f"Welcome back, {ws['name']}. Is this the best number to call you back on if we get disconnected?"
            ws["phase"] = "start_callback"
        else:
            assistant_reply = "Hello, thanks for calling Fortell Autos. May I take your name?"
        conversation_state[call_id].append({"role": "assistant", "content": assistant_reply})
        return func.HttpResponse(assistant_reply, status_code=200)

    if ws["phase"] == "start_callback":
        name = ws.get("name") or ""
        assistant_reply = (
            f"Hello {name}. Is this the best number to call you back on if we get disconnected?"
        )
        conversation_state[call_id].append({"role": "assistant", "content": assistant_reply})
        return func.HttpResponse(assistant_reply, status_code=200)


    if ws["phase"] == "start_reason":
        assistant_reply = "Thanks. What are you calling about today?"
        conversation_state[call_id].append({"role": "assistant", "content": assistant_reply})
        return func.HttpResponse(assistant_reply, status_code=200)

    # ---------------------------------------------------------
    # BUILD SYSTEM PROMPT (WORKFLOW PHASES ONLY)
    # ---------------------------------------------------------
    client_name = "fortell"  # or from env for multi-tenant
    system_prompt = build_system_prompt(client_name, ws)

    # DEBUG: log the final system prompt actually sent to the model
    logging.info("SYSTEM PROMPT:\n" + system_prompt)

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(conversation_state[call_id])

    # ---------------------------------------------------------
    # CALL MODEL
    # ---------------------------------------------------------
    try:
        AOAI_ENDPOINT = os.environ["AOAI_ENDPOINT"]
        AOAI_API_KEY = os.environ["AOAI_API_KEY"]
        AOAI_DEPLOYMENT = os.environ["AOAI_DEPLOYMENT"]

        assistant_reply = call_model(
            messages,
            endpoint=AOAI_ENDPOINT,
            api_key=AOAI_API_KEY,
            deployment=AOAI_DEPLOYMENT
        )

    except Exception as e:
        logging.error(f"Model error: {e}")
        return func.HttpResponse(f"Model error: {e}", status_code=500)

    # Store reply
    conversation_state[call_id].append(
        {"role": "assistant", "content": assistant_reply}
    )

    return func.HttpResponse(assistant_reply, status_code=200)




