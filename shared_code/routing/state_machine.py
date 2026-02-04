from datetime import datetime
from shared_code.utils.workflow_loader import load_workflow
from shared_code.utils.config_loader import load_merged_config



def next_state(intent: str, session: dict) -> str:
    """
    Determine the next workflow state based on:
    - current state
    - workflow definition
    - captured fields
    - decision logic

    This version:
    - Fixes capture logic (None/"" no longer count as captured)
    - Immediately resolves decision states (loops until prompt state)
    - Prevents determine_warranty_status from ever surfacing as a prompt
    """

    workflow = load_workflow(
        intent,
        session.get("client_id"),
        session.get("industry")
    )

    states = workflow.get("states", {})
    current = session.get("state", "start")

    while True:
        state_def = states.get(current, {})

        # If state missing, fall back to start once
        if not state_def and current != "start":
            current = "start"
            state_def = states.get(current, {})

        # ----------------------------------------------------
        # 1. Capture-gated transitions (corrected)
        # ----------------------------------------------------
        capture_field = state_def.get("capture")
        if capture_field:
            value = session.get(capture_field)
            if value is None or value == "":
                # Stay in this state until we actually have a value
                return current

        # ----------------------------------------------------
        # 2. Decision-based branching
        # ----------------------------------------------------
        if "decision" in state_def:
            decision_type = state_def["decision"]

            if decision_type == "warranty_status":
                next_state_name, decision_value = evaluate_warranty_status(state_def, session)
                session["warranty_status"] = decision_value
                current = next_state_name
                # Loop again so we land on a real prompt state
                continue

            # Unknown decision type → stay put
            return current

        # ----------------------------------------------------
        # 3. Simple linear transition
        # ----------------------------------------------------
        next_state_name = state_def.get("next")
        if next_state_name:
            current = next_state_name
            # Loop so we can immediately resolve any decision state we land on
            continue

        # ----------------------------------------------------
        # 4. No transition defined → remain in current state
        # ----------------------------------------------------
        return current


def evaluate_warranty_status(state_def: dict, session: dict):
    """
    Determines warranty status based on purchase date and mileage.
    Returns:
        (next_state_name, "in_warranty" | "out_of_warranty")
    """

    purchase_date = session.get("purchase_date")
    mileage = session.get("mileage")

    # Load warranty period from config
    client_id = session.get("client_id")
    industry = session.get("industry")
    config = load_merged_config(client_id, industry)

    warranty_months = config.get("warranty_period_months", 36)
    mileage_limit = 60000  # still configurable later if needed

    # 1. Check purchase date first
    if purchase_date:
        try:
            year = int(str(purchase_date)[:4])
            month = int(str(purchase_date)[5:7])
            day = int(str(purchase_date)[8:10])

            purchase_dt = datetime(year, month, day)
            now = datetime.now()

            age_months = (now.year - purchase_dt.year) * 12 + (now.month - purchase_dt.month)

            if age_months > warranty_months:
                return state_def["on_out_of_warranty"], "out_of_warranty"

        except Exception:
            pass

    # 2. If purchase date inconclusive, check mileage
    if mileage:
        try:
            if int(mileage) > mileage_limit:
                return state_def["on_out_of_warranty"], "out_of_warranty"
        except ValueError:
            pass

    # 3. Otherwise assume in warranty
    return state_def["on_in_warranty"], "in_warranty"




