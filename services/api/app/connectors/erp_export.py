from pathlib import Path
from .csv_dropfolder import CSVDropFolderConnector


class ERPExportConnector(CSVDropFolderConnector):
    name = "erp_export"

    def __init__(self, folder: Path):
        super().__init__(folder)
