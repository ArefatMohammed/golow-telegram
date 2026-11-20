"""`python -m golow_telegram polling` for local development; the server runs uvicorn (see Dockerfile)."""

import asyncio
import logging
import sys

from .app import run_polling

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if sys.argv[1:] != ["polling"]:
        sys.exit("usage: python -m golow_telegram polling")
    asyncio.run(run_polling())
