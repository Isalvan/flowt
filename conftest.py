import sys
import re

# Python 3.14 compatibility patches for third-party libraries (functions_framework & google-protobuf)
if not hasattr(re, "T"):
    re.T = 0
if not hasattr(re, "TEMPLATE"):
    re.TEMPLATE = 0

sys.modules["google._upb._message"] = None
