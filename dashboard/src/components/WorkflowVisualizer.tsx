"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    Edge,
    Node,
    OnNodesDelete
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, Trash2, Save, X } from 'lucide-react';

interface WorkflowVisualizerProps {
    jsonContent: any;
    onChange: (newContent: any) => void;
    industryDefaults?: any;
    onOpenPrompts?: () => void;
}

import { Handle, Position } from 'reactflow';

// Custom Node Types
const DefaultNode = ({ data }: { data: any }) => {
    return (
        <div className="px-2.5 py-1.5 shadow-md rounded bg-blue-600 min-w-[125px] text-center text-[12px]">
            <Handle type="target" position={Position.Top} className="w-12 !bg-gray-500" />
            <div className="font-semibold text-white">{data.label}</div>
            <Handle type="source" position={Position.Bottom} className="w-12 !bg-gray-500" />
        </div>
    );
};

const InputNode = ({ data }: { data: any }) => {
    return (
        <div className="px-2.5 py-1.5 shadow-md rounded bg-green-900 min-w-[125px] text-center text-[12px]">
            <div className="font-semibold text-green-100">{data.label}</div>
            <Handle type="source" position={Position.Bottom} className="w-12 !bg-green-400" />
        </div>
    );
};

const HandoffNode = ({ data }: { data: any }) => {
    return (
        <div className="px-2.5 py-1 shadow-md rounded bg-purple-900 min-w-[130px] text-center text-[12px]">
            <Handle type="target" position={Position.Top} className="w-12 !bg-purple-500" />
            <div className="flex items-center justify-center gap-2">
                <span className="text-[13px]">↪️</span>
                <div className="font-semibold text-white">{data.label}</div>
            </div>
            <div className="text-[10px] text-purple-300 mt-0.5">Alt-click to jump</div>
            <Handle type="source" position={Position.Bottom} className="w-12 !bg-purple-500" />
        </div>
    );
};

const ActionNode = ({ data }: { data: any }) => {
    return (
        <div className="px-2.5 py-1.5 shadow-md rounded bg-blue-900 min-w-[125px] text-center text-[12px]">
            <Handle type="target" position={Position.Top} className=" !bg-blue-400" />
            <div className="flex items-center justify-center gap-2">
                <span className="text-[13px]">⚡</span>
                <div className="font-semibold text-white text-[12px]">{data.label}</div>
            </div>
            <div className={`text-[10px] mt-0.5 font-mono ${data.actionType === 'webhook' ? 'text-orange-300' : 'text-blue-200'}`}>
                {data.actionType?.toUpperCase() || 'NO ACTION SET'}
            </div>
            <Handle type="source" position={Position.Bottom} className=" !bg-blue-400" />
        </div>
    );
};

const nodeTypes = {
    custom: DefaultNode,
    custom_input: InputNode,
    handoff: HandoffNode,
    action: ActionNode,
};

const initialNodes = [
    { id: '1', position: { x: 0, y: 0 }, data: { label: 'Start' } }
];
const initialEdges: Edge[] = [];

export default function WorkflowVisualizer({ jsonContent, onChange, industryDefaults, onOpenPrompts }: WorkflowVisualizerProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Selection State
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [nodeLabel, setNodeLabel] = useState<string>("");
    const [edgeLabel, setEdgeLabel] = useState<string>("");
    const [newPromptKey, setNewPromptKey] = useState<string>("");
    const [newPromptText, setNewPromptText] = useState<string>("");
    const [promptError, setPromptError] = useState<string>("");

    // Modal State
    const [showIntentModal, setShowIntentModal] = useState(false);
    const [newIntentName, setNewIntentName] = useState("");

    const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<string | null>(null);
    const [nodePanelPos, setNodePanelPos] = useState<{ x: number; y: number } | null>(null);
    const [edgePanelPos, setEdgePanelPos] = useState<{ x: number; y: number } | null>(null);
    const dragState = useRef<{
        panel: 'node' | 'edge';
        startX: number;
        startY: number;
        startLeft: number;
        startTop: number;
    } | null>(null);

    // Initial Load
    useEffect(() => {
        if (!selectedWorkflowKey && jsonContent.workflows) {
            const keys = Object.keys(jsonContent.workflows);
            if (keys.length > 0) {
                // Priority: Configured Default -> General -> First Available
                const defaultIntent = jsonContent.default_intent;
                if (defaultIntent && keys.includes(defaultIntent)) {
                    setSelectedWorkflowKey(defaultIntent);
                } else if (keys.includes('general')) {
                    setSelectedWorkflowKey('general');
                } else {
                    setSelectedWorkflowKey(keys[0]);
                }
            }
        }
    }, [jsonContent, selectedWorkflowKey]);

    // Update Graph when Tab Changes (Load from Props)
    // NOTE: We excluded jsonContent from deps to avoid overwriting local state during auto-sync
    // The parent component must use a `key` prop to force remount when the underlying file changes.
    useEffect(() => {
        if (selectedWorkflowKey && jsonContent.workflows && jsonContent.workflows[selectedWorkflowKey]) {
            const wf = jsonContent.workflows[selectedWorkflowKey];
            const normalizedNodes = (wf.nodes || []).map((node: any) => {
                const nextType = !node.type || node.type === "default"
                    ? "custom"
                    : node.type === "input"
                        ? "custom_input"
                        : node.type;
                return { ...node, type: nextType };
            });
            setNodes(normalizedNodes);
            setEdges(wf.edges || []);
        } else if (selectedWorkflowKey && industryDefaults?.workflows && industryDefaults.workflows[selectedWorkflowKey]) {
            const wf = industryDefaults.workflows[selectedWorkflowKey];
            const normalizedNodes = (wf.nodes || []).map((node: any) => {
                const nextType = !node.type || node.type === "default"
                    ? "custom"
                    : node.type === "input"
                        ? "custom_input"
                        : node.type;
                return { ...node, type: nextType };
            });
            setNodes(normalizedNodes);
            setEdges(wf.edges || []);
        } else {
            setNodes([]);
            setEdges([]);
        }
    }, [selectedWorkflowKey, setNodes, setEdges, industryDefaults]);

    // One-time migration: ensure all nodes have a type persisted in JSON
    useEffect(() => {
        if (!jsonContent.workflows) return;
        if (jsonContent.__node_types_migrated) return;

        let changed = false;
        const updatedWorkflows: Record<string, any> = {};

        Object.entries(jsonContent.workflows || {}).forEach(([key, wf]: any) => {
            const nodes = (wf.nodes || []).map((node: any) => {
                if (!node.type || node.type === "default") {
                    changed = true;
                    return { ...node, type: "custom" };
                }
                if (node.type === "input") {
                    changed = true;
                    return { ...node, type: "custom_input" };
                }
                return node;
            });
            updatedWorkflows[key] = { ...wf, nodes };
        });

        if (changed) {
            onChange({
                ...jsonContent,
                __node_types_migrated: true,
                workflows: updatedWorkflows
            });
        }
    }, [jsonContent, onChange]);

    // Auto-Sync to Parent
    useEffect(() => {
        if (!selectedWorkflowKey) return;

        const timer = setTimeout(() => {
            const workflows = jsonContent.workflows || {};

            // Only sync if nodes/edges are populated (avoid syncing initial empty state over existing data)
            if (nodes.length === 0 && edges.length === 0) return;

                        const updatedWorkflows = {
                            ...workflows,
                            [selectedWorkflowKey]: {
                                nodes: nodes.map((node) => ({
                                    ...node,
                                    type: node.type === "default" ? "custom" : node.type
                                })),
                                edges
                            }
                        };

            onChange({
                ...jsonContent,
                workflows: updatedWorkflows
            });
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [nodes, edges, selectedWorkflowKey, onChange]);

    // Handle Selection
    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        // Handoff jump only on modifier to allow editing/deleting
        if (event.altKey && node.type === 'handoff' && node.data.targetWorkflow) {
            const target = node.data.targetWorkflow;
            if (jsonContent.workflows && jsonContent.workflows[target]) {
                setSelectedWorkflowKey(target);
                return;
            }
        }

        setSelectedNodeId(node.id);
        setSelectedEdgeId(null); // Deselect edge
        setNodeLabel(node.data.label);
    }, [jsonContent, setSelectedWorkflowKey]);

    const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
        setSelectedEdgeId(edge.id);
        setSelectedNodeId(null); // Deselect node
        setEdgeLabel(edge.label as string || "");
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
    }, []);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragState.current) return;
            const { panel, startX, startY, startLeft, startTop } = dragState.current;
            const nextX = Math.max(10, startLeft + (e.clientX - startX));
            const nextY = Math.max(10, startTop + (e.clientY - startY));
            if (panel === 'node') setNodePanelPos({ x: nextX, y: nextY });
            if (panel === 'edge') setEdgePanelPos({ x: nextX, y: nextY });
        };
        const onUp = () => {
            dragState.current = null;
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

    const startDrag = (panel: 'node' | 'edge', event: React.MouseEvent) => {
        event.preventDefault();
        const pos = panel === 'node' ? nodePanelPos : edgePanelPos;
        if (!pos) return;
        dragState.current = {
            panel,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: pos.x,
            startTop: pos.y
        };
    };

    useEffect(() => {
        if (selectedNodeId && !nodePanelPos && typeof window !== 'undefined') {
            setNodePanelPos({
                x: Math.max(20, Math.floor(window.innerWidth / 2 - 160)),
                y: Math.max(20, Math.floor(window.innerHeight / 2 - 220))
            });
        }
    }, [selectedNodeId, nodePanelPos]);

    useEffect(() => {
        if (selectedEdgeId && !edgePanelPos && typeof window !== 'undefined') {
            setEdgePanelPos({
                x: Math.max(20, Math.floor(window.innerWidth / 2 - 160)),
                y: Math.max(20, Math.floor(window.innerHeight / 2 - 220))
            });
        }
    }, [selectedEdgeId, edgePanelPos]);

    // CRUD Operations
    const handleAddNode = () => {
        const newId = (Math.random() * 10000).toFixed(0);
        const newNode: Node = {
            id: newId,
            position: { x: 250, y: 100 + (nodes.length * 50) },
            data: { label: `New Step` },
            type: 'custom'
        };
        setNodes((nds) => nds.concat(newNode));
        setSelectedNodeId(newId);
        setSelectedEdgeId(null);
        setNodeLabel("New Step");
    };

    const handleAddHandoffNode = () => {
        const newId = (Math.random() * 10000).toFixed(0);
        const newNode: Node = {
            id: newId,
            position: { x: 250, y: 100 + (nodes.length * 50) },
            data: { label: `Handoff`, targetWorkflow: '' },
            type: 'handoff'
        };
        setNodes((nds) => nds.concat(newNode));
        setSelectedNodeId(newId);
        setSelectedEdgeId(null);
        setNodeLabel("Handoff");
    };

    const handleAddActionNode = () => {
        const newId = (Math.random() * 10000).toFixed(0);
        const newNode: Node = {
            id: newId,
            position: { x: 250, y: 100 + (nodes.length * 50) },
            data: { label: `Action`, actionType: 'email', actionConfig: {} },
            type: 'action'
        };
        setNodes((nds) => nds.concat(newNode));
        setSelectedNodeId(newId);
        setSelectedEdgeId(null);
        setNodeLabel("Action");
    };

    const handleDeleteNode = () => {
        if (!selectedNodeId) return;
        setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
        setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
        setSelectedNodeId(null);
    };

    const handleDeleteEdge = () => {
        if (!selectedEdgeId) return;
        setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
        setSelectedEdgeId(null);
    };

    const handleAddConnectedNode = (type: 'default' | 'handoff' | 'action') => {
        if (!selectedNodeId) return;

        const sourceNode = nodes.find(n => n.id === selectedNodeId);
        if (!sourceNode) return;

        const newId = (Math.random() * 10000).toFixed(0);

        // Calculate position (simple offset)
        const newPos = {
            x: sourceNode.position.x,
            y: sourceNode.position.y + 150
        };

        const newNode: Node = {
            id: newId,
            position: newPos,
            data: {
                label: type === 'handoff' ? 'Handoff' : (type === 'action' ? 'Action' : 'New Step'),
                targetWorkflow: type === 'handoff' ? '' : undefined,
                actionType: type === 'action' ? 'email' : undefined
            },
            type: type === 'default' ? 'custom' : type
        };

        const newEdge: Edge = {
            id: `e${selectedNodeId}-${newId}`,
            source: selectedNodeId,
            target: newId,
            label: 'Next'
        };

        setNodes((nds) => nds.concat(newNode));
        setEdges((eds) => eds.concat(newEdge));

        // Select the new node
        setSelectedNodeId(newId);
        setSelectedEdgeId(null);
        setNodeLabel(newNode.data.label);
    };

    const handleLabelChange = (newLabel: string) => {
        setNodeLabel(newLabel);
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNodeId) {
                    return { ...node, data: { ...node.data, label: newLabel } };
                }
                return node;
            })
        );
    };

    const handleEdgeLabelChange = (newLabel: string) => {
        setEdgeLabel(newLabel);
        setEdges((eds) =>
            eds.map((edge) => {
                if (edge.id === selectedEdgeId) {
                    return { ...edge, label: newLabel };
                }
                return edge;
            })
        );
    };

    const handleTargetWorkflowChange = (newTarget: string) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNodeId) {
                    return { ...node, data: { ...node.data, targetWorkflow: newTarget } };
                }
                return node;
            })
        );
    };

    const handlePromptKeyChange = (newKey: string) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNodeId) {
                    return { ...node, data: { ...node.data, promptKey: newKey } };
                }
                return node;
            })
        );
    };

    const handlePromptKeyWithNameChange = (newKey: string) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNodeId) {
                    return { ...node, data: { ...node.data, promptKeyWithName: newKey } };
                }
                return node;
            })
        );
    };

    const resetPromptDraft = () => {
        setNewPromptKey("");
        setNewPromptText("");
        setPromptError("");
    };

    const saveNewPrompt = () => {
        const key = newPromptKey.trim();
        const text = newPromptText.trim();
        if (!key) {
            setPromptError("Prompt key is required.");
            return;
        }
        if (promptKeysAll.includes(key)) {
            setPromptError("Prompt key already exists.");
            return;
        }
        if (!text) {
            setPromptError("Prompt text is required.");
            return;
        }

        const currentPrompts = jsonContent.prompts || {};
        onChange({
            ...jsonContent,
            prompts: {
                ...currentPrompts,
                [key]: text
            }
        });
        handlePromptKeyChange(key);
        resetPromptDraft();
    };

    const duplicatePrompt = () => {
        const sourceKey = selectedNode?.data?.promptKey || "";
        const sourceText = jsonContent.prompts?.[sourceKey] || "";
        const suggestedKey = sourceKey ? `${sourceKey}_copy` : "";
        setNewPromptKey(suggestedKey);
        setNewPromptText(sourceText);
        setPromptError("Edit the text before saving a duplicate.");
    };

    const handleActionChange = (field: string, value: any) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNodeId) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            [field]: value
                        }
                    };
                }
                return node;
            })
        );
    };

    const handleActionConfigChange = (field: string, value: any) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === selectedNodeId) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            actionConfig: {
                                ...node.data.actionConfig,
                                [field]: value
                            }
                        }
                    };
                }
                return node;
            })
        );
    };

    // Connections
    const onConnect = useCallback(
        (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
    );

    const handleSyncToJSON = () => {
        if (!selectedWorkflowKey) return;

        const workflows = jsonContent.workflows || {};

        const updatedWorkflows = {
            ...workflows,
            [selectedWorkflowKey]: {
                nodes,
                edges
            }
        };

        onChange({
            ...jsonContent,
            workflows: updatedWorkflows
        });

        alert(`Synced '${selectedWorkflowKey}' layout to JSON! Click Save to persist.`);
    };



    const confirmAddIntent = () => {
        if (!newIntentName) return;
        const name = newIntentName.toLowerCase().replace(/\s+/g, '_');

        // 1. Check if already exists in workflows
        if (jsonContent.workflows && jsonContent.workflows[name]) {
            alert("Workflow already exists!");
            return;
        }

        const updatedWorkflows = { ...(jsonContent.workflows || {}) };

        // 2. Try to copy from defaults
        if (industryDefaults?.workflows && industryDefaults.workflows[name]) {
            updatedWorkflows[name] = industryDefaults.workflows[name];
        } else {
            // 3. Create fresh
            updatedWorkflows[name] = {
                nodes: [{ id: '1', position: { x: 250, y: 50 }, data: { label: `Start ${name}` }, type: 'custom_input' }],
                edges: []
            };
        }

        // 4. Update Intent List
        const updatedIntents = Array.from(new Set([...(jsonContent.intents || []), name]));

        // 5. Update Routing Rules (Enable if exists, else create default)
        const updatedRules = { ...(jsonContent.intent_routing_rules || {}) };
        if (!updatedRules[name]) {
            updatedRules[name] = {
                keywords: [name],
                enabled: true
            };
        } else {
            updatedRules[name].enabled = true;
        }

        onChange({
            ...jsonContent,
            intents: updatedIntents,
            intent_routing_rules: updatedRules,
            workflows: updatedWorkflows
        });

        setSelectedWorkflowKey(name);
        setShowIntentModal(false);
        setNewIntentName("");
    };

    const contentWorkflows = jsonContent.workflows ? Object.keys(jsonContent.workflows) : [];
    // Ensure first_response is always in the list if available in defaults
    const defaultWorkflows = industryDefaults?.workflows ? Object.keys(industryDefaults.workflows) : [];
    const workflowKeys = Array.from(new Set([...contentWorkflows, ...defaultWorkflows]));
    const promptKeysAll = jsonContent.prompts ? Object.keys(jsonContent.prompts) : [];
    const promptKeysByIntent = selectedWorkflowKey
        ? promptKeysAll.filter(k => k === selectedWorkflowKey || k.startsWith(`${selectedWorkflowKey}_`))
        : promptKeysAll;
    const usedPromptKeys = new Set<string>();
    nodes.forEach((node: any) => {
        const pk = node?.data?.promptKey;
        const pkWithName = node?.data?.promptKeyWithName;
        if (pk) usedPromptKeys.add(pk);
        if (pkWithName) usedPromptKeys.add(pkWithName);
    });
    const promptKeys = Array.from(new Set([
        ...promptKeysByIntent,
        ...Array.from(usedPromptKeys).filter(k => promptKeysAll.includes(k))
    ]));
    const selectedNode = nodes.find(n => n.id === selectedNodeId);

    return (
        <div className="h-full w-full bg-gray-900 border border-gray-700 rounded relative flex flex-col">
            <style jsx global>{`
                .react-flow__node,
                .react-flow__node-default,
                .react-flow__node-input,
                .react-flow__node-output,
                .react-flow__node-group {
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                }
                .react-flow__node.selected,
                .react-flow__node:focus,
                .react-flow__node:focus-visible {
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                }
            `}</style>
            {/* Tab Bar */}
            <div className="flex bg-gray-800 border-b border-gray-700 px-2 pt-2 gap-1 overflow-x-auto">
                {workflowKeys.map(key => (
                    <button
                        key={key}
                        onClick={() => setSelectedWorkflowKey(key)}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${selectedWorkflowKey === key
                            ? 'bg-gray-700 text-blue-400 border-t-2 border-blue-500'
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                            }`}
                    >
                        {key === 'first_response' ? 'Initial Response' : key.charAt(0).toUpperCase() + key.slice(1)}
                    </button>
                ))}

                {/* Add New Workflow Button */}
                <button
                    onClick={() => setShowIntentModal(true)}
                    className="px-3 py-2 text-gray-500 hover:text-green-400"
                    title="Add Intent / Workflow"
                >
                    <Plus size={16} />
                </button>
            </div>


            {/* Add Intent Modal */}
            {showIntentModal && (
                <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center">
                    <div className="bg-gray-800 border-2 border-gray-600 rounded-lg p-6 w-96 shadow-2xl">
                        <h3 className="text-xl font-bold text-white mb-4">Add Intent Workflow</h3>

                        {/* Suggest from Defaults */}
                        {industryDefaults?.intents && (
                            <div className="mb-4">
                                <label className="block text-xs uppercase text-gray-400 font-bold mb-2">Available from Industry</label>
                                <div className="flex flex-wrap gap-2">
                                    {industryDefaults.intents
                                        .filter((i: string) => !workflowKeys.includes(i))
                                        .map((i: string) => (
                                            <button
                                                key={i}
                                                onClick={() => setNewIntentName(i)}
                                                className="px-3 py-1 bg-gray-700 hover:bg-blue-600 text-xs rounded-full text-white border border-gray-600"
                                            >
                                                {i}
                                            </button>
                                        ))
                                    }
                                </div>
                            </div>
                        )}

                        <label className="block text-xs uppercase text-gray-400 font-bold mb-2">Intent Name</label>
                        <input
                            type="text"
                            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white mb-4 focus:border-blue-500 outline-none"
                            placeholder="e.g. sales, support..."
                            value={newIntentName}
                            onChange={(e) => setNewIntentName(e.target.value)}
                        />

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowIntentModal(false)}
                                className="px-4 py-2 text-gray-400 hover:text-white text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmAddIntent}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold"
                            >
                                Add Workflow
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 relative flex overflow-hidden">
                {/* Toolbar */}
                <div className="absolute top-2 right-2 z-10 flex gap-2">
                    <button
                        onClick={handleAddNode}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-sm shadow mb-2"
                    >
                        <Plus size={16} /> Add Step
                    </button>
                    <button
                        onClick={handleAddHandoffNode}
                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded text-sm shadow mb-2"
                    >
                        <Plus size={16} /> Add Handoff
                    </button>
                    <button
                        onClick={handleAddActionNode}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm shadow mb-2"
                    >
                        <Plus size={16} /> Add Action
                    </button>
                    <div className="flex items-center gap-2 bg-blue-900/50 text-blue-200 px-3 py-1 rounded text-xs shadow mb-2 border border-blue-800">
                        Auto-saving...
                    </div>
                </div>

                {/* Main Canvas */}
                <div className="flex-1 h-full relative">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onEdgeClick={onEdgeClick}
                        onPaneClick={onPaneClick}
                        fitView
                    >
                        <Controls />
                        <MiniMap />
                        <Background gap={12} size={1} />
                    </ReactFlow>
                </div>

                {/* Edit Panel (Node) */}
                {selectedNode && nodePanelPos && (
                    <div
                        className="absolute w-80 bg-gray-800 border-2 border-blue-500 rounded-lg shadow-xl p-4 z-20 flex flex-col gap-3"
                        style={{ left: nodePanelPos.x, top: nodePanelPos.y }}
                    >
                        <div
                            className="flex justify-between items-center border-b border-gray-700 pb-2 cursor-move"
                            onMouseDown={(e) => startDrag('node', e)}
                        >
                            <span className="text-sm font-bold text-blue-400">Edit Node ({selectedNodeId})</span>
                            <button onClick={() => setSelectedNodeId(null)} className="text-gray-400 hover:text-white">
                                <X size={16} />
                            </button>
                        </div>

                        <div>
                            <label className="text-xs text-gray-400 uppercase font-semibold">Label</label>
                            <input
                                type="text"
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white mt-1 focus:border-blue-500 outline-none"
                                value={nodeLabel}
                                onChange={(e) => handleLabelChange(e.target.value)}
                            />
                        </div>

                        {selectedNode?.type === 'handoff' && (
                            <div>
                                <label className="text-xs text-gray-400 uppercase font-semibold">Target Workflow</label>
                                <select
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white mt-1 focus:border-blue-500 outline-none"
                                    value={selectedNode.data.targetWorkflow || ""}
                                    onChange={(e) => handleTargetWorkflowChange(e.target.value)}
                                >
                                    <option value="">-- Select Workflow --</option>
                                    {workflowKeys.map(k => (
                                        <option key={k} value={k}>{k}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {selectedNode?.type === 'action' && (
                            <div className="space-y-3">
                                {(() => {
                                    const isLockedAction =
                                        selectedNode.data.actionType === "extract_name" ||
                                        selectedNode.data.actionType === "detect_intent";
                                    return (
                                        <>
                                <div>
                                    <label className="text-xs text-blue-400 uppercase font-semibold">Action Type</label>
                                    <select
                                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white mt-1 focus:border-blue-500 outline-none"
                                        value={selectedNode.data.actionType || "email"}
                                        disabled={isLockedAction}
                                        onChange={(e) => handleActionChange("actionType", e.target.value)}
                                    >
                                        <option value="extract_name">Extract Name</option>
                                        <option value="email">Send Email</option>
                                        <option value="sms">Send SMS</option>
                                        <option value="webhook">API Webhook</option>
                                        <option value="whisper">Whisper (Call Manager)</option>
                                        <option value="database_query">Database Query</option>
                                        <option value="detect_intent">Detect Intent</option>
                                    </select>
                                    {isLockedAction && (
                                        <div className="text-[10px] text-gray-500 mt-1">
                                            This action type is locked for system nodes.
                                        </div>
                                    )}
                                </div>

                                {selectedNode.data.actionType === 'email' && (
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="To (e.g. sales@example.com)"
                                            value={selectedNode.data.actionConfig?.to || ""}
                                            onChange={(e) => handleActionConfigChange("to", e.target.value)}
                                        />
                                        <input
                                            type="text"
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="Subject"
                                            value={selectedNode.data.actionConfig?.subject || ""}
                                            onChange={(e) => handleActionConfigChange("subject", e.target.value)}
                                        />
                                    </div>
                                )}

                                {selectedNode.data.actionType === 'sms' && (
                                    <input
                                        type="text"
                                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                        placeholder="Phone Number"
                                        value={selectedNode.data.actionConfig?.phone || ""}
                                        onChange={(e) => handleActionConfigChange("phone", e.target.value)}
                                    />
                                )}

                                {selectedNode.data.actionType === 'webhook' && (
                                    <input
                                        type="text"
                                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                        placeholder="URL (POST)"
                                        value={selectedNode.data.actionConfig?.url || ""}
                                        onChange={(e) => handleActionConfigChange("url", e.target.value)}
                                    />
                                )}

                                {selectedNode.data.actionType === 'whisper' && (
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="Target Number (optional)"
                                            value={selectedNode.data.actionConfig?.target_number || ""}
                                            onChange={(e) => handleActionConfigChange("target_number", e.target.value)}
                                        />
                                        <textarea
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="Message (supports {assistant}, {brand}, {name}, {phone})"
                                            rows={3}
                                            value={selectedNode.data.actionConfig?.message || ""}
                                            onChange={(e) => handleActionConfigChange("message", e.target.value)}
                                        />
                                    </div>
                                )}

                                {selectedNode.data.actionType === 'database_query' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] text-gray-400 mb-1 block">Connection</label>
                                        <select
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:border-blue-500 outline-none"
                                            value={selectedNode.data.actionConfig?.connection_ref || ""}
                                            onChange={(e) => handleActionConfigChange("connection_ref", e.target.value)}
                                        >
                                            <option value="">-- None (Use Override) --</option>
                                            {Object.keys(jsonContent.database_connections || {}).map(k => (
                                                <option key={k} value={k}>{k}</option>
                                            ))}
                                        </select>
                                        <label className="text-[10px] text-gray-400 mb-1 block">DB Type (optional override)</label>
                                        <select
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:border-blue-500 outline-none"
                                            value={selectedNode.data.actionConfig?.database_type || ""}
                                            onChange={(e) => handleActionConfigChange("database_type", e.target.value)}
                                        >
                                            <option value="">-- From Connection --</option>
                                            <option value="postgres">PostgreSQL</option>
                                            <option value="mysql">MySQL</option>
                                            <option value="sqlserver">SQL Server</option>
                                            <option value="sqlite">SQLite</option>
                                            <option value="custom">Custom</option>
                                        </select>
                                        <input
                                            type="text"
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="Connection String (optional override)"
                                            value={selectedNode.data.actionConfig?.connection_string || ""}
                                            onChange={(e) => handleActionConfigChange("connection_string", e.target.value)}
                                        />
                                        <input
                                            type="text"
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="SQLite Path (optional override)"
                                            value={selectedNode.data.actionConfig?.sqlite_path || ""}
                                            onChange={(e) => handleActionConfigChange("sqlite_path", e.target.value)}
                                        />
                                        <textarea
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="SQL query with variables, e.g. SELECT * FROM customers WHERE phone = {phone_number}"
                                            rows={4}
                                            value={selectedNode.data.actionConfig?.query_template || ""}
                                            onChange={(e) => handleActionConfigChange("query_template", e.target.value)}
                                        />
                                        <input
                                            type="text"
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="Result Variable (default: db_result)"
                                            value={selectedNode.data.actionConfig?.result_var || ""}
                                            onChange={(e) => handleActionConfigChange("result_var", e.target.value)}
                                        />
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                type="number"
                                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                                placeholder="Max Rows (default 10)"
                                                value={selectedNode.data.actionConfig?.max_rows ?? ""}
                                                onChange={(e) => handleActionConfigChange("max_rows", e.target.value === "" ? "" : parseInt(e.target.value, 10) || 10)}
                                            />
                                            <input
                                                type="number"
                                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                                placeholder="Timeout sec (default 5)"
                                                value={selectedNode.data.actionConfig?.timeout_seconds ?? ""}
                                                onChange={(e) => handleActionConfigChange("timeout_seconds", e.target.value === "" ? "" : parseFloat(e.target.value) || 5)}
                                            />
                                        </div>
                                        <label className="text-[10px] text-gray-300 flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={!!selectedNode.data.actionConfig?.single_row}
                                                onChange={(e) => handleActionConfigChange("single_row", e.target.checked)}
                                                className="accent-blue-500"
                                            />
                                            Store single row only
                                        </label>
                                        <input
                                            type="text"
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                            placeholder="Error Prompt (optional)"
                                            value={selectedNode.data.actionConfig?.error_prompt || ""}
                                            onChange={(e) => handleActionConfigChange("error_prompt", e.target.value)}
                                        />
                                    </div>
                                )}

                                {selectedNode.data.actionType === 'detect_intent' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] text-gray-400 mb-1 block">Fixed Intent (optional)</label>
                                        <select
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:border-blue-500 outline-none"
                                            value={selectedNode.data.actionConfig?.fixed_intent || ""}
                                            onChange={(e) => handleActionConfigChange("fixed_intent", e.target.value)}
                                        >
                                            <option value="">-- Detect Automatically --</option>
                                            {workflowKeys.map(k => (
                                                <option key={k} value={k}>{k}</option>
                                            ))}
                                        </select>
                                        <div className="text-[10px] text-gray-500">
                                            If set, this node will hand off to the fixed intent immediately.
                                        </div>
                                    </div>
                                )}
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                        <div>
                            <label className="text-xs text-green-400 uppercase font-semibold">Capture To Variable</label>
                            <input
                                type="text"
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white mt-1 text-xs focus:border-green-500 outline-none"
                                placeholder="e.g. bottle_count"
                                value={selectedNode.data.captureVariable || ""}
                                onChange={(e) => handleActionChange("captureVariable", e.target.value)}
                            />
                        </div>

                        {/* Behavior Settings */}
                        <div className="pt-2 border-t border-gray-700 mt-2">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs text-orange-400 uppercase font-semibold">Behavior Override</label>
                                <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedNode.data.behavior_override || false}
                                        onChange={(e) => handleActionChange("behavior_override", e.target.checked)}
                                        className="w-3 h-3 bg-gray-900 border-gray-600 rounded"
                                    />
                                    <span className="text-[10px] text-gray-400">Enable</span>
                                </label>
                            </div>

                            {selectedNode.data.behavior_override && (
                                <div className="space-y-2">
                                    <div>
                                        <label className="text-[10px] text-gray-400 mb-1 block">Question Mode</label>
                                        <select
                                            value={selectedNode.data.question_mode || "single_turn"}
                                            onChange={(e) => handleActionChange("question_mode", e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:border-blue-500 outline-none"
                                        >
                                            <option value="single_turn">Single Turn</option>
                                            <option value="multi_turn">Multi Turn</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-400 mb-1 block">Max Follow-ups</label>
                                        <input
                                            type="number"
                                            value={selectedNode.data.max_follow_ups ?? 0}
                                            onChange={(e) => handleActionChange("max_follow_ups", parseInt(e.target.value) || 0)}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:border-blue-500 outline-none"
                                            min="-1"
                                            max="10"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 pt-2 border-t border-gray-700 mt-2">
                            <button
                                onClick={() => handleAddConnectedNode('default')}
                                className="flex-1 bg-gray-700 hover:bg-gray-600 text-xs py-1 rounded text-white"
                            >
                                + Append Step
                            </button>
                            <button
                                onClick={() => handleAddConnectedNode('handoff')}
                                className="flex-1 bg-purple-900 hover:bg-purple-800 text-xs py-1 rounded text-white"
                            >
                                + Append Handoff
                            </button>
                            <button
                                onClick={() => handleAddConnectedNode('action')}
                                className="flex-1 bg-blue-900 hover:bg-blue-800 text-xs py-1 rounded text-white"
                            >
                                + Append Action
                            </button>
                        </div>

                        {/* Prompt Linking Section */}
                        <div className="pt-2 border-t border-gray-700 mt-2">
                            <label className="text-xs text-blue-400 uppercase font-semibold">Linked Prompt</label>

                            <select
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white mt-1 mb-2 text-xs focus:border-blue-500 outline-none"
                                value={selectedNode.data.promptKey || ""}
                                onChange={(e) => handlePromptKeyChange(e.target.value)}
                            >
                                <option value="">-- No Prompt Linked --</option>
                                {promptKeys.map(k => (
                                    <option key={k} value={k}>{k}</option>
                                ))}
                            </select>

                            <label className="text-xs text-blue-300 uppercase font-semibold">Prompt When Name Known (optional)</label>
                            <select
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white mt-1 mb-2 text-xs focus:border-blue-500 outline-none"
                                value={selectedNode.data.promptKeyWithName || ""}
                                onChange={(e) => handlePromptKeyWithNameChange(e.target.value)}
                            >
                                <option value="">-- Use Linked Prompt --</option>
                                {promptKeys.map(k => (
                                    <option key={k} value={k}>{k}</option>
                                ))}
                            </select>

                            {selectedNode.data.promptKey && (
                                <>
                                    <textarea
                                        className="w-full h-24 bg-gray-900 border border-gray-600 rounded p-2 text-xs text-gray-400 font-mono resize-none outline-none"
                                        value={jsonContent.prompts?.[selectedNode.data.promptKey] || ""}
                                        placeholder="Prompt text..."
                                        readOnly
                                    />
                                    {selectedNode.data.promptKeyWithName && (
                                        <textarea
                                            className="w-full h-24 bg-gray-900 border border-gray-600 rounded p-2 text-xs text-gray-400 font-mono resize-none outline-none mt-2"
                                            value={jsonContent.prompts?.[selectedNode.data.promptKeyWithName] || ""}
                                            placeholder="Prompt text when name is known..."
                                            readOnly
                                        />
                                    )}
                                    <div className="text-[10px] text-gray-500 mt-1">
                                        Prompts are edited in the Prompts tab to keep them reusable.
                                    </div>
                                    {onOpenPrompts && (
                                        <button
                                            onClick={onOpenPrompts}
                                            className="mt-2 w-full bg-gray-700 hover:bg-gray-600 text-xs py-1 rounded text-white"
                                        >
                                            Open Prompts Tab
                                        </button>
                                    )}
                                </>
                            )}

                            <div className="pt-3 border-t border-gray-700 mt-3">
                                <div className="text-xs text-gray-400 mb-2">Create / Duplicate Prompt (local)</div>
                                <div className="flex gap-2 mb-2">
                                    <button
                                        onClick={duplicatePrompt}
                                        className="flex-1 bg-gray-700 hover:bg-gray-600 text-xs py-1 rounded text-white"
                                    >
                                        Duplicate Current
                                    </button>
                                    <button
                                        onClick={resetPromptDraft}
                                        className="flex-1 bg-gray-800 hover:bg-gray-700 text-xs py-1 rounded text-white"
                                    >
                                        New Blank
                                    </button>
                                </div>
                                <input
                                    type="text"
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                    placeholder={`${selectedWorkflowKey || "intent"}_prompt_key`}
                                    value={newPromptKey}
                                    onChange={(e) => setNewPromptKey(e.target.value)}
                                />
                                <textarea
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs mt-2"
                                    placeholder="Prompt text..."
                                    rows={3}
                                    value={newPromptText}
                                    onChange={(e) => setNewPromptText(e.target.value)}
                                />
                                {promptError && (
                                    <div className="text-[10px] text-red-400 mt-1">{promptError}</div>
                                )}
                                <button
                                    onClick={() => {
                                        const sourceKey = selectedNode?.data?.promptKey || "";
                                        const sourceText = jsonContent.prompts?.[sourceKey] || "";
                                        if (sourceKey && newPromptText.trim() === sourceText.trim()) {
                                            setPromptError("Duplicate must be edited before saving.");
                                            return;
                                        }
                                        saveNewPrompt();
                                    }}
                                    className="mt-2 w-full bg-blue-700 hover:bg-blue-600 text-xs py-1 rounded text-white"
                                >
                                    Save Prompt Locally
                                </button>
                            </div>
                        </div>

                        <div className="pt-2 flex justify-between">
                            <button
                                onClick={handleDeleteNode}
                                className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm font-medium"
                            >
                                <Trash2 size={16} /> Delete Node
                            </button>
                        </div>
                    </div>
                )}

                {/* Edit Panel (Edge) */}
                {selectedEdgeId && edgePanelPos && (
                    <div
                        className="absolute w-80 bg-gray-800 border-2 border-yellow-500 rounded-lg shadow-xl p-4 z-20 flex flex-col gap-3"
                        style={{ left: edgePanelPos.x, top: edgePanelPos.y }}
                    >
                        <div
                            className="flex justify-between items-center border-b border-gray-700 pb-2 cursor-move"
                            onMouseDown={(e) => startDrag('edge', e)}
                        >
                            <span className="text-sm font-bold text-yellow-500">Edit Connection</span>
                            <button onClick={() => setSelectedEdgeId(null)} className="text-gray-400 hover:text-white">
                                <X size={16} />
                            </button>
                        </div>

                        <div>
                            <label className="text-xs text-gray-400 uppercase font-semibold">Logic / Label</label>
                            <input
                                type="text"
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white mt-1 focus:border-yellow-500 outline-none"
                                value={edgeLabel}
                                placeholder="e.g. Yes, No, > X"
                                onChange={(e) => handleEdgeLabelChange(e.target.value)}
                            />
                        </div>

                        <div className="pt-2 flex justify-between">
                            <button
                                onClick={handleDeleteEdge}
                                className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm font-medium"
                            >
                                <Trash2 size={16} /> Delete Connection
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
