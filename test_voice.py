import os
import requests
import json

API_KEY = os.getenv("ELEVENLABS_API_KEY", "sk_8be92445cdda39fc35df381fd170fd6a934508ee305dc945")

def test_voice(voice_id, text="Hi, I am Nova with AutoNova. How can I help you today?"):
    # Using the same settings as the bot (Multilingual v2)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json"
    }
    
    data = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.8,
            "similarity_boost": 0.5
        }
    }

    print(f"Generating audio for voice {voice_id}...")
    try:
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 200:
            filename = f"test_voice_{voice_id}.mp3"
            with open(filename, "wb") as f:
                f.write(response.content)
            print(f"Success! Audio saved to: {filename}")
            print("Play it to hear how it sounds.")
            # Try to open it automatically
            os.system(f"start {filename}")
        else:
            print(f"Error: {response.status_code}")
            print(response.text)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # You can change this ID to test others
    # Default: Charlotte (British)
    VOICE_ID = "XB0fDUnXU5powFXDhCwa" 
    
    # Or start an interactive loop
    vid = input(f"Enter Voice ID (Press Enter for Charlotte: {VOICE_ID}): ").strip()
    if not vid:
        vid = VOICE_ID
        
    test_voice(vid)
