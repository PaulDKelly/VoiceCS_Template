import unittest

from shared_code.workflows.generic_engine import _to_spoken_currency, _to_spoken_value


class SpokenCurrencyTests(unittest.TestCase):
    def test_normalizes_stt_lbs_in_budget(self):
        self.assertEqual(_to_spoken_value("budget", "40,000 lbs."), "40,000 pounds")

    def test_normalizes_common_currency_formats(self):
        self.assertEqual(_to_spoken_currency("£31,795"), "31,795 pounds")
        self.assertEqual(_to_spoken_currency("299 GBP"), "299 pounds")
        self.assertEqual(_to_spoken_currency("$450.50"), "450.50 dollars")
        self.assertEqual(_to_spoken_currency("120 EUR"), "120 euros")

    def test_does_not_change_weight_outside_currency_fields(self):
        self.assertEqual(_to_spoken_value("parcel_weight", "40 lbs."), "40 lbs.")


if __name__ == "__main__":
    unittest.main()
