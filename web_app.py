import runpy
import sys

if __name__ == '__main__':
    runpy.run_module('backend.web.app', run_name='__main__')
else:
    from backend.web import app as _app_module

    sys.modules[__name__] = _app_module
