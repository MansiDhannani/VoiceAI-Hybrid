import os
import subprocess
import sys
from packaging.version import Version

import setuptools.command.build_py
import setuptools.command.develop
from setuptools import find_packages, setup

python_version = sys.version.split()[0]
if Version(python_version) < Version("3.9") or Version(python_version) >= Version("3.12"):
    raise RuntimeError("TTS requires python >= 3.9 and < 3.12 but your Python version is {}".format(sys.version))

cwd = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(cwd, "TTS", "VERSION")) as fin:
    version = fin.read().strip()


class build_py(setuptools.command.build_py.build_py):
    def run(self):
        setuptools.command.build_py.build_py.run(self)


class develop(setuptools.command.develop.develop):
    def run(self):
        setuptools.command.develop.develop.run(self)


package_data = ["TTS/server/templates/*"]

requirements = open(os.path.join(cwd, "requirements.txt"), "r").readlines()
with open(os.path.join(cwd, "requirements.notebooks.txt"), "r") as f:
    requirements_notebooks = f.readlines()
with open(os.path.join(cwd, "requirements.dev.txt"), "r") as f:
    requirements_dev = f.readlines()
with open(os.path.join(cwd, "requirements.ja.txt"), "r") as f:
    requirements_ja = f.readlines()
requirements_all = requirements_dev + requirements_notebooks + requirements_ja

with open("README.md", "r", encoding="utf-8") as readme_file:
    README = readme_file.read()

setup(
    name="TTS",
    version=version,
    url="https://github.com/coqui-ai/TTS",
    author="Eren Gölge",
    author_email="egolge@coqui.ai",
    description="Deep learning for Text to Speech by Coqui.",
    long_description=README,
    long_description_content_type="text/markdown",
    license="MPL-2.0",
    # No C extensions — monotonic_align pure Python fallback used instead
    ext_modules=[],
    include_package_data=True,
    packages=find_packages(include=["TTS*"]),
    package_data={
        "TTS": ["VERSION", ".models.json"],
    },
    cmdclass={
        "build_py": build_py,
        "develop": develop,
    },
    install_requires=requirements,
    extras_require={
        "all": requirements_all,
        "dev": requirements_dev,
        "notebooks": requirements_notebooks,
        "ja": requirements_ja,
    },
    python_requires=">=3.9.0, <3.12",
    entry_points={"console_scripts": ["tts=TTS.bin.synthesize:main", "tts-server = TTS.server.server:main"]},
    zip_safe=False,
)
