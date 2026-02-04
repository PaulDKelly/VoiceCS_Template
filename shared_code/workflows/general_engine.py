from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion


def handle_general(session_id: str, text: str) -> dict:
    session = load_session(session_id)
    config = load_merged_config(session.get("client_id"), session.get("industry"))

    session["general_query_raw"] = text.strip()
    save_session(session_id, session)

    llm_response = _llm_general_response(text, session, config)

    return _result(llm_response, session, config)


def _llm_general_response(text: str, session: dict, config: dict) -> str:
    customer_name = session.get("customer_name") or "there"
    brand = config.get("brand_name", "the dealership")

    system_prompt = (
        "You are assisting in a general automotive enquiry. "
        "Your job is to:\n"
        "1) Acknowledge the customer's question.\n"
        "2) Ask ONE clarifying question if needed.\n"
        "3) Keep responses short and friendly.\n"
        "4) If the user says goodbye or indicates they are done, append '[HANGUP]' to the end of your response.\n"
        "Do NOT make commitments or provide technical advice."
    )

    user_prompt = (
        f"Customer name: {customer_name}\n"
        f"Brand: {brand}\n"
        f"General enquiry: {text}"
    )

    return chat_completion([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]).strip()


def _result(prompt: str, session: dict, config: dict) -> dict:
    return {"prompt": prompt, "session": session, "config": config}
