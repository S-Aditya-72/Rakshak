"""python -m rakshak_server  → starts the local inference service on 127.0.0.1:8787."""

import logging

import uvicorn

from .app import create_app
from .config import load_settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = load_settings()
    if s.host not in ("127.0.0.1", "localhost", "::1"):
        logging.getLogger("rakshak").warning("Binding to %s: the service is reachable from other machines.", s.host)
        if not s.access_token:
            logging.getLogger("rakshak").warning("RAKSHAK_ACCESS_TOKEN is not set, so every remote request will be refused.")
    uvicorn.run(create_app(s), host=s.host, port=s.port, log_level="info")


if __name__ == "__main__":
    main()
