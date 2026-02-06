"use client";

import { useCallback, useEffect, useState } from 'react';
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
}

import { Handle, Position } from 'reactflow';

// Custom Node Types
const HandoffNode = ({ data }: { data: any }) => {
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-purple-900 border-2 border-purple-500 min-w-[150px] text-center">
            <Handle type="target" position={Position.Top} className="w-16 !bg-purple-500" />
            <div className="flex items-center justify-center gap-2">
                <span className="text-xl">↪️</span>
                <div className="font-bold text-white">{data.label}</div>
            </div>
            <div className="text-[10px] text-purple-300 mt-1">Alt-click to jump</div>
            <Handle type="source" position={Position.Bottom} className="w-16 !bg-purple-500" />
        </div>
    );
};

const ActionNode = ({ data }: { data: any }) => {
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-blue-900 border-2 border-blue-400 min-w-[150px] text-center">
            <Handle type="target" position={Position.Top} className=" !bg-blue-400" />
            <div className="flex items-center justify-center gap-2">
                <span className="text-xl">⚡</span>
                <div className="font-bold text-white text-sm">{data.label}</div>
            </div>
            <div className={`text-[10px] mt-1 font-mono ${data.actionType === 'webhook' ? 'text-orange-300' : 'text-blue-200'}`}>
                {data.actionType?.toUpperCase() || 'NO ACTION SET'}
            </div>
            <Handle type="source" position={Position.Bottom} className=" !bg-blue-400" />
        </div>
    );
};

const nodeTypes = {
    handoff: HandoffNode,
    action: ActionNode,
};

const initialNodes = [
    { id: '1', position: { x: 0, y: 0 }, data: { label: 'Start' } }
];
const initialEdges: Edge[] = [];

export default function WorkflowVisualizer({ jsonContent, onChange, industryDefaults }: WorkflowVisualizerProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Selection State
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [nodeLabel, setNodeLabel] = useState<string>("");
    const [edgeLabel, setEdgeLabel] = useState<string>("");

    // Modal State
    const [showIntentModal, setShowIntentModal] = useState(false);
    const [newIntentName, setNewIntentName] = useState("");

    const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<string | null>(null);

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
            setNodes(wf.nodes || []);
            setEdges(wf.edges || []);
        } else if (selectedWorkflowKey && industryDefaults?.workflows && industryDefaults.workflows[selectedWorkflowKey]) {
            const wf = industryDefaults.workflows[selectedWorkflowKey];
            setNodes(wf.nodes || []);
            setEdges(wf.edges || []);
        } else {
            setNodes([]);
            setEdges([]);
        }
    }, [selectedWorkflowKey, setNodes, setEdges, industryDefaults]);

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
                    nodes,
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

    // CRUD Operations
    const handleAddNode = () => {
        const newId = (Math.random() * 10000).toFixed(0);
        const newNode: Node = {
            id: newId,
            position: { x: 250, y: 100 + (nodes.length * 50) },
            data: { label: `New Step` },
            type: 'default'
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
            type: type
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

    const handlePromptTextChange = (newText: string) => {
        const key = selectedNode?.data?.promptKey;
        if (!key) return;

        const currentPrompts = jsonContent.prompts || {};

        onChange({
            ...jsonContent,
            prompts: {
                ...currentPrompts,
                [key]: newText
            }
        });
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
                nodes: [{ id: '1', position: { x: 250, y: 50 }, data: { label: `Start ${name}` }, type: 'input' }],
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
    const promptKeys = jsonContent.prompts ? Object.keys(jsonContent.prompts) : [];
    const selectedNode = nodes.find(n => n.id === selectedNodeId);

    return (
        <div className="h-full w-full bg-gray-900 border border-gray-700 rounded relative flex flex-col">
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
                {selectedNode && (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-gray-800 border-2 border-blue-500 rounded-lg shadow-xl p-4 z-20 flex flex-col gap-3">
                        <div className="flex justify-between items-center border-b border-gray-700 pb-2">
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

                            {selectedNode.data.promptKey && (
                                <textarea
                                    className="w-full h-24 bg-gray-900 border border-gray-600 rounded p-2 text-xs text-gray-300 font-mono resize-none focus:border-blue-500 outline-none"
                                    value={jsonContent.prompts?.[selectedNode.data.promptKey] || ""}
                                    onChange={(e) => handlePromptTextChange(e.target.value)}
                                    placeholder="Prompt text..."
                                />
                            )}
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
                {selectedEdgeId && (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-gray-800 border-2 border-yellow-500 rounded-lg shadow-xl p-4 z-20 flex flex-col gap-3">
                        <div className="flex justify-between items-center border-b border-gray-700 pb-2">
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
