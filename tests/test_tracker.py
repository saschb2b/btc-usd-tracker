import io
import unittest
from decimal import Decimal
from unittest.mock import patch

from tracker import fetch_price, panel_label, parse_price


class TrackerTests(unittest.TestCase):
    def test_coinbase_currency_validation(self):
        good = {"data": {"base": "BTC", "currency": "USD", "amount": "76920.07"}}
        self.assertEqual(parse_price("Coinbase", good), Decimal("76920.07"))
        good["data"]["currency"] = "EUR"
        with self.assertRaises(ValueError):
            parse_price("Coinbase", good)

    def test_reject_invalid_prices(self):
        for raw in ("NaN", "Infinity", "-1", "0", "broken"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_price("Coinbase", {"data": {"base": "BTC", "currency": "USD", "amount": raw}})

    def test_kraken_error(self):
        with self.assertRaises(ValueError):
            parse_price("Kraken", {"error": ["Service unavailable"]})

    def test_network_fallback(self):
        backup = b'{"error":[],"result":{"XXBTZUSD":{"c":["76928.80000","1"]}}}'
        with patch("tracker.urllib.request.urlopen", side_effect=[OSError("offline"), io.BytesIO(backup)]) as request:
            self.assertEqual(fetch_price(), (Decimal("76928.80000"), "Kraken"))
            self.assertEqual(request.call_count, 2)

    def test_both_feeds_unavailable(self):
        with patch("tracker.urllib.request.urlopen", side_effect=OSError("offline")):
            with self.assertRaisesRegex(RuntimeError, "Coinbase:.*Kraken:"):
                fetch_price()

    def test_stale_price_is_marked(self):
        self.assertEqual(panel_label(Decimal("76920.07")), "$76,920")
        self.assertEqual(panel_label(Decimal("76920.07"), stale=True), "$76,920 *")
        self.assertEqual(panel_label(None, stale=True), "BTC offline")


if __name__ == "__main__":
    unittest.main()
