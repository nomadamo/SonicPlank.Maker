import React, { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LicenseItem {
  package: string;
  version: string;
  licenses: string;
  licenseText: string;
}

export default function LicenseViewer() {
  const [licenseData, setLicenseData] = useState<LicenseItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/all-licenses.json")
      .then((response) => response.json())
      .then((data) => {
        setLicenseData(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error loading licenses:", error);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading license information...</p>;

  return (
    <ScrollArea
      style={{
        maxHeight: "300px",
      }}
    >
      <details key={"details"}>
        <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
          Dependencies & Licenses
        </summary>

        {licenseData.map((item, index) => (
          <details
            key={index}
            style={{
              margin: "5px 0 0 0",
              padding: "5px 0 0 0",
            }}
          >
            <summary style={{ cursor: "pointer" }}>
              {item.package} @ {item.version}{" "}
              <span style={{ color: "gray", float: "right" }}>
                ({item.licenses})
              </span>
            </summary>
            <pre
              style={{
                width: "90%",
                fontFamily: "var(--font-mono)",
                borderRadius: "5px",
                backgroundColor: "var(--card)",
                whiteSpace: "pre-wrap",
                marginTop: "10px",
                marginLeft: "10px",
                marginRight: "10px",
              }}
            >
              <ScrollArea>{item.licenseText}</ScrollArea>
            </pre>
          </details>
        ))}
      </details>
    </ScrollArea>
  );
}
