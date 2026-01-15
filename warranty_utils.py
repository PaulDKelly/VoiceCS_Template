import re
import calendar
from datetime import datetime, date

DATE_PATTERNS = [
    # DD/MM/YYYY or D/M/YYYY
    r"\b(?P<day>\d{1,2})[\/\-](?P<month>\d{1,2})[\/\-](?P<year>\d{4})\b",
    # D Month YYYY (24 December 2024)
    r"\b(?P<day>\d{1,2})\s+(?P<month_name>[A-Za-z]+)\s+(?P<year>\d{4})\b",
]

MONTH_NAME_MAP = {
    m.lower(): i for i, m in enumerate(
        [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ],
        start=1
    )
}


def _add_months(d: date, months: int) -> date:
    """
    Add `months` months to a date, keeping day within valid range for target month.
    """
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def parse_purchase_date_from_text(text: str) -> date | None:
    """
    Try to extract a purchase date from free text in common UK formats.
    Returns a `date` or None if not recognised.
    """
    if not text:
        return None

    text = text.strip()

    for pattern in DATE_PATTERNS:
        m = re.search(pattern, text)
        if not m:
            continue

        gd = m.groupdict()
        try:
            day = int(gd.get("day"))
            year = int(gd.get("year"))

            if "month" in gd and gd.get("month"):
                month = int(gd["month"])
            else:
                month_name = gd.get("month_name", "").lower()
                month = MONTH_NAME_MAP.get(month_name)
                if month is None:
                    continue

            return date(year, month, day)
        except Exception:
            continue

    # Last resort: try pure DD/MM/YYYY parsing
    try:
        return datetime.strptime(text, "%d/%m/%Y").date()
    except Exception:
        return None


def calculate_warranty_status(
    purchase_date: date,
    warranty_months: int,
    today: date | None = None
) -> dict:
    """
    Strict warranty calculation:
    - purchase_date: datetime.date of purchase
    - warranty_months: int, warranty length
    - today: optional override, default = UTC today

    Returns:
    {
        "in_warranty": bool,
        "expiry_date": date
    }
    """
    if today is None:
        today = datetime.utcnow().date()

    expiry = _add_months(purchase_date, warranty_months)
    in_warranty = today <= expiry

    return {
        "in_warranty": in_warranty,
        "expiry_date": expiry
    }
