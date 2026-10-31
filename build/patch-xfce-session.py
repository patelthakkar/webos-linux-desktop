#!/usr/bin/env python3
"""Remove the Thunar daemon from the default XFCE session.

Thunar is still in the Applications menu and the panel; it starts when opened.
The session daemon is not needed and costs about 40 MB of RSS on the TV.
"""
import sys
import xml.etree.ElementTree as ET


def remove_thunar(parent):
    for child in list(parent):
        values = [value.get("value") or value.text for value in child.findall("value")]
        if (
            child.tag == "property"
            and child.get("name", "").endswith("_Command")
            and "Thunar" in values
        ):
            parent.remove(child)
        else:
            remove_thunar(child)


path = sys.argv[1]
tree = ET.parse(path)
remove_thunar(tree.getroot())
tree.write(path, encoding="utf-8", xml_declaration=True)
