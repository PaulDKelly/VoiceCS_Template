import requests
import json
import subprocess

url = "http://localhost:3000/api/config"

# 1. Test Save (should trigger git commit)
payload = {
    "action": "save",
    "type": "client",
    "industry": "automotive",
    "client": "autonova",
    "content": {
        "client_id": "autonova",
        "industry": "automotive",
        "notes": "Revision test at " + str(json.dumps("")) # Just some change
    }
}

print("Testing Save...")
res = requests.post(url, json=payload)
print(res.status_code, res.text)

# 2. Verify git commit
print("\nVerifying Git Commit...")
log = subprocess.check_output(['git', 'log', '-n', '1', '--oneline'], encoding='utf-8')
print("Latest Commit:", log)

# 3. Test History
print("\nTesting History API...")
res = requests.get(url, params={"type": "history", "industry": "automotive", "client": "autonova"})
print(res.status_code)
history = res.json()
if history:
    print(f"Found {len(history)} revisions. Latest: {history[0]['hash']}")
    
    # 4. Test Revert
    latest_hash = history[0]['hash']
    # If there are at least 2 versions, try to revert to the previous one
    if len(history) > 1:
        prev_hash = history[1]['hash']
        print(f"\nTesting Revert to {prev_hash}...")
        res = requests.post(url, json={
            "action": "revert",
            "industry": "automotive",
            "client": "autonova",
            "hash": prev_hash
        })
        print(res.status_code, res.text)
    else:
        print("\nNot enough history to test revert.")

# 5. Test Delete
print("\nTesting Create & Delete Client...")
requests.post(url, json={"action": "create_client", "industry": "automotive", "newName": "delete_me_test"})
print("Client created.")
res = requests.post(url, json={"action": "delete_client", "industry": "automotive", "client": "delete_me_test"})
print("Delete status:", res.status_code, res.text)
