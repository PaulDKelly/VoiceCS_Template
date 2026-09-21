import difflib
import re
from typing import Optional


# Common UK and Irish first names provide a conservative correction vocabulary.
# Exact unfamiliar names are retained; only close non-name tokens are corrected.
COMMON_FIRST_NAMES = {
    "aaron", "adam", "alex", "alice", "amelia", "amy", "andrew", "anna",
    "arthur", "ava", "ben", "benjamin", "beth", "charles", "charlie",
    "charlotte", "chloe", "chris", "christopher", "claire", "dan", "daniel",
    "david", "diane", "dylan", "edward", "ella", "ellie", "emily", "emma",
    "ethan", "evie", "finlay", "fiona", "frank", "freya", "george", "grace",
    "graham", "harry", "helen", "henry", "holly", "hugh", "ian", "isla",
    "jack", "jacob", "james", "jane", "janet", "jason", "john", "jonathan",
    "joseph", "josh", "joshua", "julie", "karen", "kate", "katie", "kevin",
    "laura", "leo", "liam", "lily", "linda", "lisa", "lucas", "lucy",
    "luke", "mark", "martin", "mary", "matt", "matthew", "maya", "megan",
    "michael", "mia", "michelle", "nathan", "neil", "niamh", "noah", "oliver",
    "olivia", "oscar", "paul", "peter", "philip", "poppy", "rachel", "rebecca",
    "richard", "robert", "ruby", "ruth", "sam", "samantha", "sarah", "scott",
    "sean", "simon", "sophie", "stephen", "steve", "steven", "susan", "thomas",
    "tom", "victoria", "william", "zoe",
}


def resolve_first_name(value: str, minimum_similarity: float = 0.74) -> Optional[str]:
    cleaned = re.sub(r"[^A-Za-z'-]", "", str(value or "")).strip("-'").lower()
    if len(cleaned) < 2:
        return None
    if cleaned in COMMON_FIRST_NAMES:
        return cleaned.capitalize()

    matches = difflib.get_close_matches(
        cleaned,
        sorted(COMMON_FIRST_NAMES),
        n=2,
        cutoff=minimum_similarity,
    )
    if not matches:
        return value.strip().capitalize()

    best_score = difflib.SequenceMatcher(None, cleaned, matches[0]).ratio()
    second_score = (
        difflib.SequenceMatcher(None, cleaned, matches[1]).ratio()
        if len(matches) > 1 else 0.0
    )
    if best_score - second_score < 0.08:
        return value.strip().capitalize()
    return matches[0].capitalize()


def resolve_person_name(value: str) -> Optional[str]:
    words = str(value or "").split()
    if not 1 <= len(words) <= 3:
        return None
    resolved = [resolve_first_name(words[0])]
    if not resolved[0]:
        return None
    resolved.extend(word.capitalize() for word in words[1:])
    return " ".join(resolved)

