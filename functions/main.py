import os
from firebase_functions import https_fn, options
from app import app as flask_app

# Allocate 1GB RAM to comfortably hold statsmodels, scipy, pandas, and 27 models in memory
@https_fn.on_request(
    memory=options.MemoryOption.GB_1,
    timeout_sec=120,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def ml_api(req: https_fn.Request) -> https_fn.Response:
    """
    Firebase 2nd Gen Cloud Function entry point routing all requests
    directly through the RMIMS Flask ML application.
    """
    with flask_app.request_context(req.environ):
        return flask_app.full_dispatch_request()
