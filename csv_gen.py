import sys

from backend.crawler.output import csv_gen as _module

sys.modules[__name__] = _module
