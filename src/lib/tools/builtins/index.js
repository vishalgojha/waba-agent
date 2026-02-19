const { toolClientInit } = require("./tool-client-init");
const { toolMemoryNote } = require("./tool-memory-note");
const { toolLeadClassify } = require("./tool-lead-classify");
const { toolSendText } = require("./tool-send-text");
const { toolSendTemplate } = require("./tool-send-template");
const { toolWebhookSetupHint } = require("./tool-webhook-setup-hint");
const { toolScheduleAddText } = require("./tool-schedule-add-text");
const { toolScheduleAddTemplate } = require("./tool-schedule-add-template");
const { toolScheduleRunDue } = require("./tool-schedule-run-due");
const { toolTranscribeVoice } = require("./tool-transcribe-voice");
const { toolVisionDescribe } = require("./tool-vision-describe");
const { toolWebhookValidate } = require("./tool-webhook-validate");
const { toolSendTextButtons } = require("./tool-send-text-buttons");
const { toolLeadScheduleFollowup } = require("./tool-lead-schedule-followup");
const { toolLeadTag } = require("./tool-lead-tag");
const { toolLeadEscalateHuman } = require("./tool-lead-escalate-human");
const { toolJaspersPlanReply } = require("./tool-jaspers-plan-reply");

function builtinTools() {
  return [
    toolClientInit(),
    toolMemoryNote(),
    toolLeadClassify(),
    toolTranscribeVoice(),
    toolVisionDescribe(),
    toolSendText(),
    toolSendTextButtons(),
    toolSendTemplate(),
    toolLeadScheduleFollowup(),
    toolLeadTag(),
    toolLeadEscalateHuman(),
    toolJaspersPlanReply(),
    toolWebhookSetupHint(),
    toolWebhookValidate(),
    toolScheduleAddText(),
    toolScheduleAddTemplate(),
    toolScheduleRunDue()
  ];
}

module.exports = { builtinTools };
