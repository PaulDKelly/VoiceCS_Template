from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion


def handle_service(session_id: str, text: str) -> dict:
    session = load_session(session_id)
    config = load_merged_config(session.get("client_id"), session.get("industry"))

    # 1. State: Need Issue Description
    if "service_issue" not in session:
        # CRITICAL: We just arrived from Warranty. The 'text' is likely "It was bought in 2024".
        # We must IGNORE this text and ask for the issue, unless we are sure.
        # Safest bet: If 'service_asking_issue' is not set, ASK.
        
        if session.get("service_asking_issue"):
             if text and text.strip():
                 session["service_issue"] = text.strip()
                 session.pop("service_asking_issue", None)
                 save_session(session_id, session)
                 # Fall through to Name
             else:
                 return _result("I see the vehicle is in warranty. Could you describe the problem you're experiencing?", session, config)
        else:
             session["service_asking_issue"] = True
             save_session(session_id, session)
             return _result("I see the vehicle is in warranty. Could you describe the problem you're experiencing?", session, config)
        
        # Fall through to next state (Name) directly? 
        # No, better to return the next prompt immediately to keep flow snappy.
        # But we need to know what the next prompt IS.
        # Let's fall through logic by checking next state.

    # 2. State: Need Booking Name (Mandatory)
    if "service_booking_name" not in session:
        # Check if we are currently asking for it
        if session.get("awaiting_booking_name"):
            if text and text.strip():
                session["service_booking_name"] = text.strip()
                # Also update main customer name
                session["customer_name"] = text.strip()
                session.pop("awaiting_booking_name", None)
                save_session(session_id, session)
            else:
                 return _result("Could I take your full name for the booking?", session, config)
        else:
            # First time reaching this state.
            # Even if we have customer_name, the user wants us to ask "anyway".
            # So we trigger the ask.
            session["awaiting_booking_name"] = True
            save_session(session_id, session)
            return _result("Thanks. To get this booked in, could I take your full name?", session, config)

    # 2.5 State: Need Phone Number (Mandatory)
    if not session.get("phone_confirmed"):
        if session.get("awaiting_phone_confirmation"):
             if text and text.strip():
                 session["phone_number"] = text.strip() # Overwrite caller ID
                 session["phone_confirmed"] = True
                 session.pop("awaiting_phone_confirmation", None)
                 save_session(session_id, session)
                 # Fall through to Address
             else:
                 return _result("Could you please provide the best telephone number to contact you on?", session, config)
        else:
             session["awaiting_phone_confirmation"] = True
             save_session(session_id, session)
             return _result("Thanks. And what is the best telephone number to contact you on?", session, config)

    # 3. State: Need Address
    if "customer_address" not in session:
        if session.get("awaiting_address"):
             if text and text.strip():
                 session["customer_address"] = text.strip()
                 session.pop("awaiting_address", None)
                 # Do not save yet, falls through to confirmation
                 save_session(session_id, session)
             else:
                 return _result("Could you please provide your full address and postcode?", session, config)
        else:
             session["awaiting_address"] = True
             save_session(session_id, session)
             return _result("Thanks. And could you please provide your full address?", session, config)

    # 3.5 State: Confirm Address (New)
    if not session.get("address_confirmed"):
        current_address = session["customer_address"]
        
        # Helper to make TTS sound better
        tts_address = current_address.replace(" Dr.", " Drive").replace(" St.", " Street").replace(" Rd.", " Road")
        
        # Check if we are already asking for confirmation
        if session.get("awaiting_address_confirmation"):
            if not text or not text.strip():
                return _result(f"I have the address as: {tts_address}. Is that correct?", session, config)
            
            # Simple keyword check for "Yes"
            lower_text = text.lower().strip()
            yes_words = ["yes", "correct", "right", "yeah", "yep", "sure", "that's it"]
            no_words = ["no", "wrong", "incorrect", "nah", "nope", "not right"]
            
            if any(x in lower_text for x in yes_words):
                session["address_confirmed"] = True
                session.pop("awaiting_address_confirmation", None)
                save_session(session_id, session)
                # Fall through to booking
            
            elif any(x in lower_text for x in no_words):
                # User said "No": Reset and ask again
                session.pop("customer_address", None)
                session.pop("awaiting_address_confirmation", None)
                
                # Set state to Waiting for Address
                session["awaiting_address"] = True
                save_session(session_id, session)
                return _result("Sorry about that. Could you please provide the full address again?", session, config)
                
            else:
                # Assume correction or continuation (e.g. "And the postcode is...")
                new_address = f"{current_address}, {text.strip()}"
                session["customer_address"] = new_address
                save_session(session_id, session)
                # Re-calculate TTS
                tts_new = new_address.replace(" Dr.", " Drive").replace(" St.", " Street").replace(" Rd.", " Road")
                return _result(f"Thanks. I've updated that to: {tts_new}. Is that correct?", session, config)
        else:
            session["awaiting_address_confirmation"] = True
            save_session(session_id, session)
            return _result(f"Thanks. I have the address as: {tts_address}. Is that correct?", session, config)

    # 4. State: Finalize Booking
    if session.get("booking_completed"):
         return _result("I have already processed your booking. confirmed. Goodbye! [HANGUP]", session, config)

    from shared_code.utils.email_client import send_booking_email
    
    # Get email from config
    booking_config = config.get("booking_config", {})
    recipient = booking_config.get("notification_email")
    
    # Attempt to send email
    success = send_booking_email(
        session, 
        session["service_issue"], 
        session["customer_address"], 
        recipient_email=recipient
    )
    
    session["booking_completed"] = True
    save_session(session_id, session)
    
    if success:
            msg = "Great. I've sent those details to our service team. You will receive a confirmation shortly. Goodbye! [HANGUP]"
    else:
            msg = "Great. I've noted your details. We will contact you shortly to confirm the booking. Goodbye! [HANGUP]"
            
    return _result(msg, session, config)


def _llm_interpret_service_issue(text: str, session: dict, config: dict) -> str:
    # Deprecated but kept for reference if needed, or remove? 
    # The new flow is deterministic slot filling.
    pass


def _result(prompt: str, session: dict, config: dict) -> dict:
    return {"prompt": prompt, "session": session, "config": config}
