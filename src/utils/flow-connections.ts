import { Connection, Node } from "@xyflow/react";

export interface HandleConnectionRule {
  allowedSourceTypes: string[];
  allowedSourceHandleSuffix?: string;
}

// Registry mapping: targetNodeType -> targetHandleSuffix -> Rule
export const CONNECTION_RULES: Record<string, Record<string, HandleConnectionRule>> = {
  targetOutputNode: {
    source_target: {
      allowedSourceTypes: ["captureSourceNode"],
      allowedSourceHandleSuffix: "source",
    },
    overlay_target: {
      allowedSourceTypes: ["overlayGroupNode"],
      allowedSourceHandleSuffix: "source",
    },
  },
  overlayGroupNode: {
    target: {
      allowedSourceTypes: [
        "textOverlayNode",
        "colorOverlayNode",
        "imageOverlayNode",
        "visualizerOverlayNode",
        "nowPlayingNode",
        "twitchChatNode",
      ],
      allowedSourceHandleSuffix: "source",
    },
  },
  nowPlayingNode: {
    target: {
      allowedSourceTypes: ["audioFlowNode"],
      allowedSourceHandleSuffix: "source",
    },
  },
  visualizerOverlayNode: {
    target: {
      allowedSourceTypes: ["audioFlowNode"],
      allowedSourceHandleSuffix: "source",
    },
  },
  masterOutputNode: {
    target: {
      allowedSourceTypes: ["audioFlowNode"],
      allowedSourceHandleSuffix: "source",
    },
  },
};

/**
 * Extracts the suffix from a handle ID given the node ID.
 * e.g., handle_dndnode_0_source_target -> source_target
 */
export function getHandleSuffix(nodeId: string, handleId: string | null): string {
  if (!handleId) return "";
  const prefix = `handle_${nodeId}_`;
  if (handleId.startsWith(prefix)) {
    return handleId.slice(prefix.length);
  }
  return handleId;
}

/**
 * Validates whether a connection is allowed based on the central registry.
 */
export function isValidConnection(
  connection: Connection,
  nodes: Node[]
): boolean {
  const { source, target, sourceHandle, targetHandle } = connection;
  
  console.log("[Connection Validation] Checking:", {
    source,
    target,
    sourceHandle,
    targetHandle
  });

  if (!source || !target || !sourceHandle || !targetHandle) {
    console.log("[Connection Validation] Missing fields. Rejected.");
    return false;
  }

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);

  if (!sourceNode || !targetNode) {
    console.log("[Connection Validation] Source or target node not found. Rejected.");
    return false;
  }

  const targetType = targetNode.type;
  if (!targetType) {
    console.log("[Connection Validation] Target node type is missing. Rejected.");
    return false;
  }

  const rulesForTarget = CONNECTION_RULES[targetType];
  if (!rulesForTarget) {
    console.log(`[Connection Validation] No target rules for type: ${targetType}. Rejected.`);
    return false;
  }

  const targetSuffix = getHandleSuffix(target, targetHandle);
  const rule = rulesForTarget[targetSuffix];
  if (!rule) {
    console.log(`[Connection Validation] No target handle rule for suffix: ${targetSuffix}. Rejected.`);
    return false;
  }

  const sourceType = sourceNode.type;
  if (!sourceType || !rule.allowedSourceTypes.includes(sourceType)) {
    console.log(`[Connection Validation] Source type "${sourceType}" not allowed for target type "${targetType}" (allowed: ${rule.allowedSourceTypes.join(", ")}). Rejected.`);
    return false;
  }

  if (rule.allowedSourceHandleSuffix) {
    const sourceSuffix = getHandleSuffix(source, sourceHandle);
    if (sourceSuffix !== rule.allowedSourceHandleSuffix) {
      console.log(`[Connection Validation] Source handle suffix "${sourceSuffix}" does not match allowed "${rule.allowedSourceHandleSuffix}". Rejected.`);
      return false;
    }
  }

  console.log("[Connection Validation] Connection is VALID! Approved.");
  return true;
}
