t=open('template.html').read()
core=open('core.js').read().replace("if (typeof module !== 'undefined') module.exports = CNC;","")
t=t.replace('/*CORE*/',core).replace('/*TPL*/',open('templates.js').read()).replace('/*APP*/',open('app.js').read())
open('cnc-risalnik.html','w').write(t)
