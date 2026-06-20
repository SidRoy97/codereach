# codesec — AI Context

This file gives AI coding assistants a complete mental model of this codebase.
It is tool-agnostic — works with Claude Code, Cursor, ChatGPT, Gemini, and Copilot.
Regenerate: `Cmd+Shift+P -> Codescape: Generate AI Context File`.

## Project Structure

```
codesec/
    |-- media/
    |   |-- grammars/
    |-- src/
    |   |-- config/
    |   |   |-- ConfigManager.ts                    
    |   |-- context/
    |   |   |-- AiContextGenerator.ts               
    |   |   |-- ContextPicker.ts                    
    |   |   |-- FileSummarizer.ts                   
    |   |-- graph/
    |   |   |-- CodeGraphBuilder.ts                 
    |   |   |-- CodeGraphTypes.ts                   
    |   |   |-- GraphPanel.ts                       
    |   |   |-- ImpactAnalyzer.ts                   
    |   |   |-- ImpactCodeLens.ts                   
    |   |   |-- LanguageParser.ts                   
    |   |-- interfaces/
    |   |   |-- index.ts                            
    |   |-- providers/
    |   |   |-- CodeActionsProvider.ts              
    |   |   |-- DashboardProvider.ts                
    |   |-- publishers/
    |   |   |-- DiagnosticsPublisher.ts             
    |   |   |-- StatusBarManager.ts                 
    |   |-- reports/
    |   |   |-- ProblemsReporter.ts                 
    |   |-- rules/
    |   |   |-- javaRules.ts                        
    |   |   |-- javascriptRules.ts                  
    |   |   |-- pythonRules.ts                      
    |   |   |-- reactRules.ts                       
    |   |-- scanners/
    |   |   |-- AiScanner.ts                        
    |   |   |-- ComplexityScanner.ts                
    |   |   |-- DuplicateScanner.ts                 
    |   |   |-- StaticScanner.ts                    
    |   |-- AnalysisOrchestrator.ts             
    |   |-- ResultStore.ts                      
    |   |-- extension.ts                        
    |   |-- types.ts                            
    |-- README.md                           
    |-- codescape-issues.json               
    |-- codescape-issues.md                 
    |-- codescape.json                      
    |-- package.json                        
    |-- tsconfig.json                       
```

## File Responsibilities

> Run `Codescape: Summarize Project Files` to populate this section.

## High-Impact Files — Edit With Care

Changing these files affects many others. Check dependents before editing.

- `src/ResultStore.ts` — affects 17 other symbol(s)
- `src/graph/LanguageParser.ts` — affects 12 other symbol(s)
- `src/config/ConfigManager.ts` — affects 11 other symbol(s)
- `src/scanners/AiScanner.ts` — affects 8 other symbol(s)
- `src/rules/pythonRules.ts` — affects 7 other symbol(s)
- `src/rules/javascriptRules.ts` — affects 7 other symbol(s)
- `src/rules/javaRules.ts` — affects 7 other symbol(s)
- `src/rules/reactRules.ts` — affects 7 other symbol(s)
- `src/graph/CodeGraphBuilder.ts` — affects 7 other symbol(s)
- `src/scanners/ComplexityScanner.ts` — affects 6 other symbol(s)

## Symbol Index

Every function, class, and method — and where to find it:

```
// src/ResultStore.ts
  class      ResultStore                         L6
  method     save                                L12
  method     get                                 L17
  method     getAll                              L22
  method     remove                              L27
  method     clear                               L32

// src/reports/ProblemsReporter.ts
  class      ProblemsReporter                    L28
  method     constructor                         L29
  method     generate                            L35
  method     buildReport                         L64
  method     enrich                              L84
  method     enclosingFunction                   L99
  method     toMarkdown                          L111
  method     toJson                              L167

// src/publishers/StatusBarManager.ts
  class      StatusBarManager                    L5
  method     constructor                         L9
  method     render                              L17
  method     dispose                             L41

// src/publishers/DiagnosticsPublisher.ts
  class      DiagnosticsPublisher                L11
  method     present                             L17
  method     clear                               L23
  method     clearAll                            L28
  method     toDiagnostic                        L33
  method     dispose                             L55

// src/scanners/ComplexityScanner.ts
  class      ComplexityScanner                   L13
  method     constructor                         L16
  method     scan                                L18
  method     getAverageComplexity                L49
  method     normalizeLang                       L59

// src/scanners/StaticScanner.ts
  class      StaticScanner                       L13
  method     scan                                L16
  method     getLines                            L38

// src/scanners/AiScanner.ts
  class      AiScanner                           L46
  method     constructor                         L49
  method     scan                                L51
  method     generateText                        L91
  method     callOllama                          L111
  method     callHuggingFace                     L147
  method     callOpenAiFormat                    L207
  method     callAnthropic                       L247
  method     parseResponse                       L275
  method     requiresKey                         L312
  method     showMissingKeyMessage               L317
  method     handleError                         L336

// src/scanners/DuplicateScanner.ts
  class      DuplicateScanner                    L6
  method     constructor                         L9
  method     scan                                L11
  method     scanWithBlocks                      L16
  method     normalize                           L25
  method     findDuplicates                      L32
  method     hash                                L58
  method     toIssue                             L64

// src/rules/pythonRules.ts
  function   runPythonRules                      L211

// src/rules/javascriptRules.ts
  function   runJavaScriptRules                  L198
  function   detectLongFunctions                 L236

// src/rules/javaRules.ts
  function   runJavaRules                        L197

// src/rules/reactRules.ts
  function   runReactRules                       L276
  function   detectStateSprawl                   L315
  function   detectMissingDepArrays              L345
  function   detectPropDrilling                  L373

// src/types.ts
  function   toVsCodeSeverity                    L42

// src/graph/CodeGraphBuilder.ts
  class      CodeGraphBuilder                    L13
  method     constructor                         L17
  method     build                               L20
  method     getGraph                            L77
  method     exportToFile                        L83
  method     dropCompiledSiblings                L97
  method     enclosingSymbolId                   L109
  method     resolveEdges                        L128
  method     isInsideWorkspace                   L159
  method     workspaceRoot                       L165

// src/graph/ImpactCodeLens.ts
  class      ImpactCodeLens                      L9
  method     constructor                         L13
  method     refresh                             L16
  method     provideCodeLenses                   L20

// src/graph/LanguageParser.ts
  class      LanguageParser                      L73
  method     constructor                         L79
  method     init                                L82
  method     grammarKey                          L91
  method     loadLanguage                        L99
  method     parse                               L115
  method     walk                                L158
  method     readName                            L168
  method     readCalleeName                      L175

// src/graph/GraphPanel.ts
  class      GraphPanel                          L13
  method     constructor                         L16
  method     show                                L22
  method     renderImpact                        L49
  method     handleMessage                       L61
  method     buildHtml                           L102
  method     makeNonce                           L219

// src/graph/ImpactAnalyzer.ts
  class      ImpactAnalyzer                      L15
  method     constructor                         L16
  method     analyze                             L20
  method     blastRadiusForFile                  L35
  method     findUnusedSymbols                   L56
  method     callersOf                           L69
  method     calleesOf                           L77
  method     affectedBy                          L86
  method     findNode                            L103
  method     nodesByIds                          L107

// src/extension.ts
  function   activate                            L45
  function   activateInternal                    L57
  function   deactivate                          L440
  function   langToExts                          L445
  function   generateProjectConfig               L458

// src/providers/CodeActionsProvider.ts
  class      CodeActionsProvider                 L22
  method     constructor                         L26
  method     provideCodeActions                  L50
  method     applyFix                            L87
  method     showDiff                            L131
  method     explainIssue                        L153
  method     dispose                             L178
  class      ExplainPanel                        L184
  method     show                                L187
  method     mdToHtml                            L236

// src/providers/DashboardProvider.ts
  class      DashboardProvider                   L11
  method     constructor                         L15
  method     resolveWebviewView                  L17
  method     refresh                             L30
  method     handleMessage                       L38
  method     buildHtml                           L83
  method     buildFileCard                       L269
  method     computeSummary                      L300
  method     catLabel                            L320
  method     sevDot                              L327
  method     esc                                 L331
  method     dispose                             L335

// src/config/ConfigManager.ts
  class      ConfigManager                       L5
  method     cfg                                 L8
  method     getAiProvider                       L13
  method     getAiModel                          L18
  method     getAiApiKey                         L23
  method     getAiBaseUrl                        L28
  method     isAiEnabled                         L33
  method     isStaticEnabled                     L38
  method     getComplexityThreshold              L43
  method     getDuplicateThreshold               L48
  method     getLanguages                        L53
  method     shouldAnalyzeOnSave                 L65

// src/AnalysisOrchestrator.ts
  class      AnalysisOrchestrator                L11
  method     constructor                         L16
  method     analyze                             L26
  method     runPhased                           L38
  method     runAiPhase                          L86
  method     removeCrossRulesetDuplicates        L123
  method     filterAiDuplicates                  L167
  method     sameRootConcept                     L203
  method     keyWords                            L238
  method     deduplicate                         L256
  method     debounced                           L266
  method     dispose                             L283

// src/context/AiContextGenerator.ts
  class      AiContextGenerator                  L16
  method     constructor                         L17
  method     generate                            L23
  method     buildContent                        L49
  method     findHighImpactFiles                 L141
  method     buildFolderTree                     L157
  method     isSourceFile                        L201

// src/context/ContextPicker.ts
  class      ContextPicker                       L11
  method     constructor                         L12
  method     buildContext                        L19
  method     buildLightContext                   L97

// src/context/FileSummarizer.ts
  class      FileSummarizer                      L20
  method     constructor                         L24
  method     summarizeWorkspace                  L30
  method     getSummaries                        L96
  method     formatForAi                         L102
  method     loadCache                           L114
  method     saveCache                           L129
  method     getCachePath                        L140
  method     hashString                          L144

```

---
*Generated 19/06/2026, 21:16:31 by Codescape — works with any AI tool*