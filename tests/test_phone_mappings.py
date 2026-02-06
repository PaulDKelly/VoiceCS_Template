import json
import importlib


def test_load_phone_mappings_normalizes_keys(tmp_path, monkeypatch):
    data = {
        "mappings": {
            "+44 115-647-3116": {
                "client_id": "Thirsty Work",
                "industry": "sales",
            }
        }
    }

    path = tmp_path / "phone_mappings.json"
    path.write_text(json.dumps(data), encoding="utf-8")

    monkeypatch.setenv("APP_CONFIG_PATH", str(tmp_path))
    import shared_code.utils.config_loader as config_loader
    importlib.reload(config_loader)

    mappings = config_loader.load_phone_mappings()

    assert "+441156473116" in mappings
    assert "+44 115-647-3116" in mappings
