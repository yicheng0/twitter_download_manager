import runpy
import sys


if __name__ == '__main__':
    runpy.run_module('backend.tools.proxy_health_checker', run_name='__main__')
else:
    from backend.tools import proxy_health_checker as _module

    sys.modules[__name__] = _module
