import os
import pickle
import numpy as np
import pandas as pd
import scipy.sparse.linalg._interface as _interface

_orig_setstate = _interface.LinearOperator.__setstate__
def _safe_setstate(self, state):
    if isinstance(state, dict) and '_xp' not in state:
        state['_xp'] = 'numpy'
    return _orig_setstate(self, state)
_interface.LinearOperator.__setstate__ = _safe_setstate

model_path = r"C:\Users\Zeanna\anaconda_projects\5a70a50b-0461-4709-9dc1-4c77a803041b\rmims_time_series_model.pkl"
print(f"Loading: {model_path}")
with open(model_path, "rb") as f:
    models = pickle.load(f)

print(f"SUCCESS: Loaded {len(models)} models!")
print(f"Materials count: {len(models)}")
print(f"Materials list: {list(models.keys())}")

# Test forecast for a sample material
sugar_model = models.get("Sugar") or models.get("OVERALL_TOTAL")
if sugar_model:
    forecast_vals = sugar_model.forecast(7)
    print("\nSample 7-day forecast for Sugar/OVERALL_TOTAL:")
    print(forecast_vals)
