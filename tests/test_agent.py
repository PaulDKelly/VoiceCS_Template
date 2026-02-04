from shared_code.agent.agent_engine import run_agent_step


# Use a fixed session ID so the conversation persists across steps
session_id = "local-test-session"

def print_step(title, response):
    print(f"\n=== {title} ===")
    print("Prompt:", response.get("prompt"))
    print("Session:", response.get("session"))
    print("Config:", response.get("config"))


# STEP 1 — Greeting (empty input triggers greeting flow)
resp1 = run_agent_step(session_id, "")
print_step("STEP 1: Greeting", resp1)


# STEP 2 — Caller gives their name
resp2 = run_agent_step(session_id, "Paul")
print_step("STEP 2: Name Capture", resp2)


# STEP 3 — Caller states their issue (LLM intent detection happens here)
resp3 = run_agent_step(session_id, "I have a problem with my car")
print_step("STEP 3: Intent Detection", resp3)


# STEP 4 — Warranty engine asks for purchase date; user provides it
resp4 = run_agent_step(session_id, "It was bought in June 2021")
print_step("STEP 4: Warranty Date", resp4)


# STEP 5 — Warranty engine asks for issue description; user provides it
resp5 = run_agent_step(session_id, "The engine makes a rattling noise when cold")
print_step("STEP 5: Issue Description", resp5)
