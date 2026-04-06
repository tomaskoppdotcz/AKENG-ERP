"""Ensure application loggers emit to stderr (uvicorn default often hides app.* INFO)."""

from __future__ import annotations

import logging
import sys

_APP_CONSOLE_MARKER = "_akeng_app_console"


def configure_app_console_logging(level: int = logging.INFO) -> None:
    """Attach a stderr StreamHandler to the ``app`` logger so child loggers (e.g. app.services.*) are visible."""
    app_logger = logging.getLogger("app")
    app_logger.setLevel(level)
    for h in app_logger.handlers:
        if getattr(h, _APP_CONSOLE_MARKER, False):
            return
    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(level)
    setattr(handler, _APP_CONSOLE_MARKER, True)
    handler.setFormatter(
        logging.Formatter("%(levelname)s [%(name)s] %(message)s"),
    )
    app_logger.addHandler(handler)
    # Avoid duplicating the same lines on the root logger (uvicorn may attach handlers there).
    app_logger.propagate = False
