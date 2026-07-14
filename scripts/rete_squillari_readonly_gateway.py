#!/usr/bin/env python3
import argparse, json
from rete_squillari_tools.gateway import WBOSReadOnlyApplicationGateway

IDENTITY = {"actor_type": "HUMAN", "actor_id": "local-reviewer", "capabilities": ["rete_squillari.locations.read", "rete_squillari.shortages.read", "rete_squillari.shortages.validate", "rete_squillari.print.preview"], "correlation_id": "cli-review"}
def main():
    parser = argparse.ArgumentParser(description="Local read-only Rete Squillari tool harness")
    parser.add_argument("command", choices=["list-tools"]); args = parser.parse_args()
    gateway = WBOSReadOnlyApplicationGateway(); print(json.dumps(gateway.list_application_tools(IDENTITY), indent=2, sort_keys=True))
if __name__ == "__main__": main()
