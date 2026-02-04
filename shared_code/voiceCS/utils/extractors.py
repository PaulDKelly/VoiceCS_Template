import re

def extract_name(text: str) -> str:
    """
    Extracts a clean first name from user input.
    Examples:
      "My name is Paul" -> "Paul"
      "I'm Sarah" -> "Sarah"
      "This is John speaking" -> "John"
      "Paul" -> "Paul"
    """

    text = text.strip()

    # Common patterns
    patterns = [
        r"my name is ([A-Za-z'-]+)",
        r"i am ([A-Za-z'-]+)",
        r"i'm ([A-Za-z'-]+)",
        r"this is ([A-Za-z'-]+)",
        r"it's ([A-Za-z'-]+)"
    ]

    lowered = text.lower()

    for pattern in patterns:
        match = re.search(pattern, lowered)
        if match:
            return match.group(1).capitalize()

    # Fallback: last word, capitalised
    parts = re.findall(r"[A-Za-z'-]+", text)
    if parts:
        return parts[-1].capitalize()

    return text.capitalize()
