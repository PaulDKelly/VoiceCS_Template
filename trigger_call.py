import os
import requests
from requests.auth import HTTPBasicAuth

# --- CONFIGURATION ---
# REPLACE THESE WITH YOUR VALUES
ACCOUNT_SID = "YOUR_TWILIO_SID"
AUTH_TOKEN  = "YOUR_TWILIO_AUTH_TOKEN"
TWILIO_NUMBER = "+441156473116"
MY_MOBILE_NUMBER = "+447970809518"
WEBHOOK_URL = "https://diactinic-goldenly-clelia.ngrok-free.dev/api/incoming-call"

def trigger_call():
    url = f"https://api.twilio.com/2010-04-01/Accounts/{ACCOUNT_SID}/Calls.json"
    
    data = {
        "From": TWILIO_NUMBER,
        "To": MY_MOBILE_NUMBER,
        "Url": WEBHOOK_URL,
        "Method": "POST"
    }
    
    print(f"Triggering call from {TWILIO_NUMBER} to {MY_MOBILE_NUMBER}...")
    print(f"Webhook: {WEBHOOK_URL}")

    try:
        response = requests.post(
            url,
            data=data,
            auth=HTTPBasicAuth(ACCOUNT_SID, AUTH_TOKEN)
        )
        
        if response.status_code == 200 or response.status_code == 201:
            print("Success! Call SID:", response.json().get("sid"))
            print("Check your phone!")
        else:
            print(f"Error {response.status_code}:")
            print(response.text) # This will show the exact reason!
            
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    trigger_call()
