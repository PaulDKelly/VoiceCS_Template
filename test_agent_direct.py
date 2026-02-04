"""
Direct test of the agent without Bot Framework
This bypasses Bot Framework to test just the agent logic
"""
import os

# Set environment variables
os.environ["CLIENT_ID"] = "autonova"
os.environ["INDUSTRY"] = "automotive"

from shared_code.agent.agent_engine import run_agent_step

print("=" * 60)
print("DIRECT AGENT TEST (No Bot Framework)")
print("=" * 60)
print()

# Test 1: Initial greeting
print("Test 1: Initial greeting (no previous session)")
print("-" * 60)
result = run_agent_step(session_id="test-session-direct", text="")
print(f"Agent Reply: {result.get('prompt')}")
print()

# Test 2: Provide name
print("Test 2: User provides name")
print("-" * 60)
result = run_agent_step(session_id="test-session-direct", text="John")
print(f"Agent Reply: {result.get('prompt')}")
print()

# Test 3: Ask about warranty
print("Test 3: User asks about warranty")
print("-" * 60)
result = run_agent_step(session_id="test-session-direct", text="I need help with warranty")
print(f"Agent Reply: {result.get('prompt')}")
print()

print("=" * 60)
print("DIRECT AGENT TEST COMPLETE")
print("=" * 60)
print()
print("[SUCCESS] If you see agent replies above, your agent logic is working!")
print("The Bot Framework integration just needs proper channel setup.")
