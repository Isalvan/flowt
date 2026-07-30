import sys
import re
from unittest.mock import MagicMock

# Python 3.14 compatibility patches for third-party libraries
if not hasattr(re, "T"):
    re.T = 0
if not hasattr(re, "TEMPLATE"):
    re.TEMPLATE = 0

sys.modules["google._upb._message"] = None

try:
    from google import genai
except ImportError:
    mock_genai = MagicMock()
    sys.modules["google.genai"] = mock_genai
    sys.modules["google.genai.types"] = MagicMock()
