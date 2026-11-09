/* 
 * share constants across client/server for all y'all strucure purists.
 */
const INIT = "init";
const CHAT = "chat";

if ((typeof module != 'undefined') && module)
    module.exports = {INIT: INIT, CHAT:CHAT}; // this only is needed and only works on the server.

