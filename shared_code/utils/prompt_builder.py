from shared_code.utils.workflow_loader import load_workflow

def build_state_prompt(intent, client_id, industry, state_name):
    workflow = load_workflow(intent, client_id, industry)
    states = workflow.get("states", {})
    state_def = states.get(state_name, {})

    print("DEBUG INTENT:", intent)
    print("DEBUG STATE NAME:", state_name)
    print("DEBUG STATE DEF:", state_def)

    prompt = state_def.get("prompt")

    if not prompt:
        return "I'm here if you need anything else."

    return prompt






