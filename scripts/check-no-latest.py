#!/usr/bin/env python3
import json
from pathlib import Path
import sys

paths = [Path('package.json')]
violations = []
for path in paths:
    data = json.loads(path.read_text())
    for section in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
        for name, version in data.get(section, {}).items():
            if version == 'latest':
                violations.append(f'{path}:{section}.{name}=latest')
if violations:
    print('Refusing floating dependency ranges:', file=sys.stderr)
    for violation in violations:
        print(f'  {violation}', file=sys.stderr)
    sys.exit(1)
