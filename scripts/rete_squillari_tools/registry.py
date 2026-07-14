from .contracts import TOOL_DEFINITIONS, ToolDefinition, validate_tool_contract

class ToolRegistry:
    def __init__(self, tools=TOOL_DEFINITIONS):
        self._tools = {}
        for tool in tools:
            if tool.name in self._tools: raise ValueError("DUPLICATE_TOOL_NAME")
            errors = validate_tool_contract(tool)
            if errors: raise ValueError("INVALID_TOOL_CONTRACT:" + ",".join(errors))
            self._tools[tool.name] = tool

    def list_tools(self):
        return [self._tools[name].as_dict() for name in sorted(self._tools)]

    def get_tool(self, name):
        return self._tools.get(name)

    def has_tool(self, name):
        return name in self._tools
