from dataclasses import dataclass


@dataclass
class ConnectorResult:
    status: str
    processed: int
    message: str = ""


class Connector:
    name = "base"

    def run(self) -> ConnectorResult:
        raise NotImplementedError
