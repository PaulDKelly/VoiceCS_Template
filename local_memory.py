import json
import os

MEMORY_FILE = "local_memory.json"

def load_memory():
    if not os.path.exists(MEMORY_FILE):
        return {}
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

def save_memory(memory):
    with open(MEMORY_FILE, "w") as f:
        json.dump(memory, f, indent=2)

def get_customer(phone_number):
    memory = load_memory()
    return memory.get(phone_number, {})

def update_customer(phone_number, data):
    memory = load_memory()
    customer = memory.get(phone_number, {})
    customer.update(data)
    memory[phone_number] = customer
    save_memory(memory)
