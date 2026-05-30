import sys

from backend.crawler.runtime import user_info as _module

sys.modules[__name__] = _module
