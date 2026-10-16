import errno, io, json, os, subprocess, sys, tempfile, unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server as app

class DepartmentTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db_patch=patch.object(app,'DB',Path(self.temp.name)/'test.sqlite3');self.db_patch.start()
        self.env=patch.dict(os.environ,{'OPENAI_API_KEY':'test-only-not-a-real-key'});self.env.start()
        app.init_db()
    def tearDown(self):
        self.env.stop();self.db_patch.stop();self.temp.cleanup()
    def create(self,**kwargs):
        with patch.object(app.threading,'Thread'):
            return app.create_run({'prompt':'Launch a product with useful content','mode':'live',**kwargs})
    def fake_response(self,text,status='completed'):
        return io.BytesIO(json.dumps({'status':status,'output':[{'content':[{'type':'output_text','text':text}]}],
            'usage':{'input_tokens':100,'output_tokens':30}}).encode())
    def test_full_live_pipeline_contract_and_order(self):
        app.execute("UPDATE settings SET value='Audience: independent designers' WHERE key='context'")
        run=self.create();requests=[]
        plan={'category':'Launch','diagnosis':'Positioning precedes content.','tasks':[
            {'agent':'gtm','brief':'Position the offer'},{'agent':'content','brief':'Draft launch content'}]}
        replies=[json.dumps(plan),'Positioning draft','Content draft','Synthesized answer']
        def provider(req,timeout):
            requests.append(json.loads(req.data));return self.fake_response(replies[len(requests)-1])
        with patch.object(app,'urlopen',side_effect=provider):app.workflow(run['id'])
        result=app.run_detail(run['id'])
        self.assertEqual(result['status'],'completed');self.assertEqual(result['answer'],'Synthesized answer')
        self.assertEqual(result['calls'],4);self.assertEqual(result['input_tokens'],400)
        self.assertTrue(all(t['status']=='completed' for t in result['tasks']))
        self.assertEqual(requests[0]['text']['format']['type'],'json_schema')
        self.assertFalse(requests[0]['store'])
        self.assertEqual(json.loads(requests[2]['input'])['earlier_specialist_outputs'][0]['output'],'Positioning draft')
        self.assertIn('independent designers',json.loads(requests[1]['input'])['business_context'])
        self.assertNotIn('test-only-not-a-real-key',json.dumps(requests))
    def test_invalid_agent_is_rejected(self):
        r=self.create()
        with patch.object(app,'call_model',return_value={'category':'x','diagnosis':'x','tasks':[{'agent':'unknown','brief':'x'}]}):app.workflow(r['id'])
        self.assertEqual(app.run_detail(r['id'])['status'],'failed')
        self.assertEqual(app.run_detail(r['id'])['tasks'],[])
    def test_duplicate_specialist_is_rejected_before_work_starts(self):
        r=self.create()
        plan={'category':'Content','diagnosis':'Two content assets','tasks':[
            {'agent':'content','brief':'Article'},{'agent':'content','brief':'Newsletter'}]}
        with patch.object(app,'call_model',return_value=plan) as provider:app.workflow(r['id'])
        self.assertEqual(provider.call_count,1)
        self.assertEqual(app.run_detail(r['id'])['tasks'],[])
        self.assertIn('same specialist twice',app.run_detail(r['id'])['error'])
    def test_invalid_diagnoses_and_oversized_assignments_are_rejected(self):
        valid={'category':'Content','diagnosis':'A useful diagnosis','tasks':[{'agent':'content','brief':'Article'}]}
        for changes in ({'category':' '},{'diagnosis':''},{'category':'x'*201},
                        {'tasks':[{'agent':'content','brief':'x'*4001}]},{'tasks':[]}):
            with self.assertRaises(ValueError):app.validate_plan({**valid,**changes})
    def test_live_work_uses_queued_role_snapshot(self):
        r=self.create();snapshot=json.loads(app.rows('SELECT team_snapshot FROM runs WHERE id=?',(r['id'],))[0]['team_snapshot'])
        plan={'category':'Launch','diagnosis':'Position the offer','tasks':[{'agent':'gtm','brief':'Positioning artifact'}]}
        requests=[];replies=[plan,'Specialist artifact','Final artifact']
        def provider(run_id,instructions,payload,schema=None):
            requests.append(instructions);return replies[len(requests)-1]
        with patch.object(app.team,'CMO_ROUTING','Changed after queueing'),patch.object(app.team,'CMO_SYNTHESIS','Changed review'),patch.object(app.team,'specialist_instructions',return_value='Changed specialist'),patch.object(app,'call_model',side_effect=provider):
            app.workflow(r['id'])
        self.assertTrue(requests[0].startswith(snapshot['routing']))
        self.assertIn(snapshot['specialists']['gtm'],requests[1])
        self.assertEqual(requests[2],snapshot['synthesis'])
        out=app.run_detail(r['id'])
        self.assertEqual(out['team_version'],app.team.TEAM_VERSION)
        self.assertNotIn('team_snapshot',out)
        self.assertIn('Team: '+app.team.TEAM_VERSION,app.export_chat(r['chat_id']))
    def test_legacy_database_migration_preserves_completed_history(self):
        legacy=Path(self.temp.name)/'legacy.sqlite3'
        with patch.object(app,'DB',legacy):
            with app.connect() as c:
                c.execute('CREATE TABLE runs (id TEXT PRIMARY KEY, chat_id TEXT, prompt TEXT, mode TEXT, status TEXT, category TEXT, diagnosis TEXT, answer TEXT, error TEXT, context TEXT, history TEXT, model TEXT, created TEXT, updated TEXT, calls INTEGER, input_tokens INTEGER, output_tokens INTEGER, cancel INTEGER, rating INTEGER)')
                c.execute("INSERT INTO runs (id,status,answer) VALUES ('legacy','completed','Preserved answer')")
            app.init_db();app.init_db()
            saved=app.rows("SELECT * FROM runs WHERE id='legacy'")[0]
            self.assertEqual(saved['status'],'completed')
            self.assertEqual(saved['answer'],'Preserved answer')
            self.assertEqual(saved['team_version'],'')
            self.assertEqual(saved['team_snapshot'],'')
    def test_partial_failure_preserves_work(self):
        r=self.create();plan={'category':'x','diagnosis':'x','tasks':[{'agent':'gtm','brief':'a'},{'agent':'content','brief':'b'},{'agent':'brand','brief':'c'}]}
        with patch.object(app,'call_model',side_effect=[plan,'Saved draft',ValueError('Provider unavailable')]):app.workflow(r['id'])
        out=app.run_detail(r['id']);self.assertEqual(out['status'],'failed')
        self.assertEqual([t['status'] for t in out['tasks']],['completed','failed','skipped'])
        self.assertEqual(out['tasks'][0]['output'],'Saved draft')
    def test_cancellation_prevents_provider_call(self):
        r=self.create();app.update_run(r['id'],cancel=1)
        with patch.object(app,'urlopen') as provider:app.workflow(r['id']);provider.assert_not_called()
        self.assertEqual(app.run_detail(r['id'])['status'],'cancelled')
    def test_inflight_cancellation_preserves_prior_work_and_usage(self):
        r=self.create()
        plan={'category':'Launch','diagnosis':'Position before content.','tasks':[
            {'agent':'gtm','brief':'Position the product'},{'agent':'content','brief':'Draft content'}]}
        replies=[json.dumps(plan),'Saved positioning','Cancelled content response'];calls=[]
        def provider(req,timeout):
            calls.append(req)
            if len(calls)==3:app.update_run(r['id'],cancel=1)
            return self.fake_response(replies[len(calls)-1])
        with patch.object(app,'urlopen',side_effect=provider):app.workflow(r['id'])
        result=app.run_detail(r['id'])
        self.assertEqual(result['status'],'cancelled')
        self.assertEqual([t['status'] for t in result['tasks']],['completed','cancelled'])
        self.assertEqual(result['tasks'][0]['output'],'Saved positioning')
        self.assertEqual(result['tasks'][1]['output'],'')
        self.assertEqual(result['calls'],3)
        self.assertEqual(result['input_tokens'],300)
    def test_one_active_run_per_conversation(self):
        r=self.create()
        with self.assertRaisesRegex(ValueError,'active request'):self.create(chat_id=r['chat_id'])
    def test_global_concurrency_limit(self):
        self.create();self.create()
        with self.assertRaisesRegex(ValueError,'Two requests'):self.create()
    def test_worker_start_failure_releases_slot_and_allows_retry(self):
        with patch.object(app.threading,'Thread') as thread:
            thread.return_value.start.side_effect=RuntimeError('cannot start new thread')
            with self.assertRaisesRegex(ValueError,'Could not start the request'):
                app.create_run({'prompt':'A saved brief','mode':'demo'})
        saved=app.rows('SELECT * FROM runs')[0]
        self.assertEqual(saved['status'],'failed')
        self.assertEqual(saved['prompt'],'A saved brief')
        retry=self.create(chat_id=saved['chat_id'],mode='demo')
        self.assertEqual(retry['chat_id'],saved['chat_id'])
        self.create(mode='demo')
    def test_second_process_cannot_interrupt_active_database(self):
        r=self.create()
        code='import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); import server; server.DB=Path(sys.argv[2]); raise SystemExit(server.main([]))'
        with app.DataDirectoryLock():
            child=subprocess.run([sys.executable,'-c',code,str(app.ROOT),str(app.DB)],capture_output=True,text=True,timeout=10)
            self.assertEqual(child.returncode,1,child.stderr)
            self.assertIn('already in use',child.stderr)
            self.assertEqual(app.run_detail(r['id'])['status'],'routing')
        with app.DataDirectoryLock():
            self.assertEqual(app.run_detail(r['id'])['status'],'routing')
    def test_startup_errors_release_lock_and_do_not_open_browser(self):
        error=io.StringIO()
        with patch.dict(os.environ,{'PORT':'8765'}),patch.object(app,'ThreadingHTTPServer',side_effect=OSError(errno.EADDRINUSE,'address in use')),patch.object(app.webbrowser,'open') as browser,redirect_stderr(error):
            self.assertEqual(app.main(['--open-browser']),1)
            browser.assert_not_called()
        self.assertIn('Port 8765 is already in use',error.getvalue())
        with app.DataDirectoryLock(): pass
    def test_invalid_port_stops_cleanly_before_startup(self):
        for value in ('abc','0','65536'):
            error=io.StringIO()
            with patch.dict(os.environ,{'PORT':value}),patch.object(app,'ThreadingHTTPServer') as server,redirect_stderr(error):
                self.assertEqual(app.main([]),1)
                server.assert_not_called()
            self.assertIn('PORT must be a whole number',error.getvalue())
    def test_data_folder_and_database_errors_are_clean(self):
        blocker=Path(self.temp.name)/'not-a-folder';blocker.write_text('fixture')
        error=io.StringIO()
        with patch.object(app,'DB',blocker/'department.sqlite3'),patch.object(app,'ThreadingHTTPServer') as server,redirect_stderr(error):
            self.assertEqual(app.main([]),1)
            server.assert_not_called()
        self.assertIn('Check AMD_DATA_DIR',error.getvalue())
        error=io.StringIO();fake=unittest.mock.Mock()
        with patch.object(app,'ThreadingHTTPServer',return_value=fake),patch.object(app,'init_db',side_effect=app.sqlite3.DatabaseError('fixture')),patch.object(app.webbrowser,'open') as browser,redirect_stderr(error):
            self.assertEqual(app.main(['--open-browser']),1)
            browser.assert_not_called()
        self.assertIn('local database could not be opened',error.getvalue())
        fake.server_close.assert_called_once()
        with app.DataDirectoryLock(): pass
    def test_browser_opens_only_after_successful_startup(self):
        events=[];fake=unittest.mock.Mock()
        def bind(*args):events.append('bound');return fake
        def ready():events.append('initialized')
        def browser(url,new):events.append(url);return True
        def serve():events.append('serving');raise KeyboardInterrupt()
        fake.serve_forever.side_effect=serve
        with patch.dict(os.environ,{'PORT':'8765'}),patch.object(app,'ThreadingHTTPServer',side_effect=bind),patch.object(app,'init_db',side_effect=ready),patch.object(app.webbrowser,'open',side_effect=browser),redirect_stdout(io.StringIO()):
            self.assertEqual(app.main(['--open-browser']),0)
        self.assertEqual(events,['bound','initialized','http://127.0.0.1:8765','serving'])
        fake.server_close.assert_called_once()
        with app.DataDirectoryLock(): pass
    def test_snapshot_and_history_exclude_demo(self):
        app.execute("UPDATE settings SET value='version one' WHERE key='context'")
        r=self.create(mode='demo');app.update_run(r['id'],status='completed',answer='Demo output')
        new=self.create(chat_id=r['chat_id'])
        app.execute("UPDATE settings SET value='version two' WHERE key='context'")
        stored=app.rows('SELECT * FROM runs WHERE id=?',(new['id'],))[0]
        self.assertEqual(stored['context'],'version one');self.assertEqual(json.loads(stored['history']),[])
    def test_api_call_budget(self):
        r=self.create();app.update_run(r['id'],calls=5)
        with patch.object(app,'urlopen') as provider:
            with self.assertRaisesRegex(ValueError,'five-call'):app.call_model(r['id'],'','')
            provider.assert_not_called()
    def test_http_failure_has_safe_message(self):
        r=self.create()
        with patch.object(app,'urlopen',side_effect=HTTPError('url',401,'unauthorized',{},None)):
            with self.assertRaisesRegex(ValueError,'API key rejected'):app.call_model(r['id'],'',{})
    def test_incomplete_and_refused_responses(self):
        r=self.create()
        for text,status in [('partial','incomplete'),('','completed')]:
            with patch.object(app,'urlopen',return_value=self.fake_response(text,status)):
                with self.assertRaises(ValueError):app.call_model(r['id'],'',{})
    def test_demo_no_network_and_export(self):
        r=self.create(mode='demo',prompt='برنامه محتوا و سئو')
        with patch.object(app.time,'sleep'),patch.object(app,'urlopen') as provider:
            app.workflow(r['id']);provider.assert_not_called()
        out=app.run_detail(r['id']);self.assertEqual(out['status'],'completed');self.assertEqual(out['calls'],0)
        self.assertEqual(out['tasks'][0]['agent'],'content')
        self.assertIn('DEMO',app.export_chat(r['chat_id']))
        self.assertIn('برنامه محتوا',app.export_chat(r['chat_id']))
    def test_restart_marks_interrupted_and_preserves_completed(self):
        r=self.create();finished=self.create();app.update_run(finished['id'],status='completed',answer='retained')
        app.init_db()
        self.assertEqual(app.run_detail(r['id'])['status'],'interrupted')
        self.assertEqual(app.run_detail(finished['id'])['answer'],'retained')
    def test_missing_key_rejects_live_but_allows_demo(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':''}):
            with self.assertRaisesRegex(ValueError,'OPENAI_API_KEY'):self.create()
            self.assertTrue(self.create(mode='demo')['id'])
    def test_request_validation(self):
        for prompt in ['',[], 'x'*12001]:
            with self.assertRaises(ValueError):self.create(prompt=prompt)
        with self.assertRaises(ValueError):self.create(chat_id='nonexistent')


class RequestHandlerTests(unittest.TestCase):
    setUp = DepartmentTests.setUp
    tearDown = DepartmentTests.tearDown
    create = DepartmentTests.create
    def request(self,path,body=None,headers=None):
        from email.message import Message
        handler=app.Handler.__new__(app.Handler)
        handler.path=path
        handler.headers=Message()
        values={'Host':f'127.0.0.1:{app.PORT}','Cookie':f'{app.session_cookie_name()}={app.SESSION}'}
        if body is not None:values.update({'Content-Type':'application/json','X-Department':'1'})
        values.update(headers or {})
        raw=json.dumps(body).encode() if body is not None else b''
        values['Content-Length']=str(len(raw))
        for k,v in values.items():handler.headers[k]=v
        handler.rfile=io.BytesIO(raw)
        result=[]
        handler.send=lambda code,data,*args,**kwargs:result.extend([code,data])
        (handler.do_POST if body is not None else handler.do_GET)()
        return result
    def test_host_origin_cookie_and_custom_header(self):
        for headers in [{'Host':'attacker.example'},{'Origin':'https://attacker.example'},{'Sec-Fetch-Site':'cross-site'}]:
            self.assertEqual(self.request('/api/state',headers=headers)[0],403)
        self.assertEqual(self.request('/api/state',headers={'Cookie':''})[0],401)
        self.assertEqual(self.request('/api/state',headers={'Cookie':f'{app.session_cookie_name()}=invalidé'})[0],401)
        self.assertEqual(self.request('/api/state',headers={'Cookie':f'amd_session_9999={app.SESSION}'})[0],401)
        self.assertEqual(self.request('/api/context',{'context':'x'},{'X-Department':''})[0],403)
        self.assertEqual(self.request('/api/state')[0],200)
    def test_private_files_not_served(self):
        for path in ['/.env','/server.py','/data/department.sqlite3','/../.env','/static/../../.env']:
            self.assertEqual(self.request(path)[0],404)
    def test_context_and_routine_roundtrip(self):
        self.assertEqual(self.request('/api/context',{'context':'شناخت کسب‌وکار'})[0],200)
        state=self.request('/api/state')[1];self.assertEqual(state['context'],'شناخت کسب‌وکار')
        self.assertNotIn('test-only-not-a-real-key',json.dumps(state))
        self.assertEqual(self.request('/api/routines',{'title':'Weekly','prompt':'Review metrics','cadence':'weekly'})[0],200)
        routine=self.request('/api/state')[1]['routines'][0]
        with patch.object(app.threading,'Thread'):
            result=self.request('/api/routines/run',{'id':routine['id'],'mode':'demo'})
        self.assertEqual(result[0],200)
        self.assertTrue(self.request('/api/state')[1]['routines'][0]['last_run'])
        self.assertEqual(self.request('/api/routines/delete',{'id':routine['id']})[0],200)
        self.assertEqual(self.request('/api/state')[1]['routines'],[])
    def test_team_and_brief_template_are_read_only_state_metadata(self):
        state=self.request('/api/state')[1]
        self.assertEqual(state['team_version'],app.team.TEAM_VERSION)
        self.assertEqual(len(state['agents']),8)
        cmo=next(a for a in state['agents'] if a['id']=='cmo')
        self.assertIn('Review evidence, resolve conflicts and synthesize the answer',cmo['method'])
        self.assertIn('90-day goal',state['business_template'])
        self.assertEqual(state['context'],'')

    def test_paid_media_catalog_is_read_only_and_routes_demo_without_network(self):
        before=app.rows('SELECT * FROM routines')
        state=self.request('/api/state')[1]
        skill=state['skills'][0]
        self.assertEqual(skill['owner'],'growth')
        self.assertEqual(len(skill['workflows']),6)
        self.assertEqual(app.rows('SELECT * FROM routines'),before)
        self.assertEqual(state['context'],'')
        for w in skill['workflows']:
            self.assertIn('Paste report data',w['prompt'])
            self.assertLessEqual(len(w['prompt']),12000)
            self.assertEqual([t['agent'] for t in app.demo_plan(w['prompt'])['tasks']],['analytics','growth'])
        with patch.object(app,'urlopen') as network:
            r=self.create(mode='demo',prompt=skill['workflows'][0]['prompt'])
            app.workflow(r['id'])
            network.assert_not_called()
        out=app.run_detail(r['id'])
        self.assertEqual(out['status'],'completed')
        self.assertEqual(out['calls'],0)
        self.assertIn('no data has been analyzed',out['tasks'][0]['output'])
        self.assertIn('Ads account review',out['tasks'][1]['output'])
        self.assertNotIn('activation milestone',out['tasks'][1]['output'])

    def test_paid_media_queued_skill_snapshot_reaches_live_workflow(self):
        r=self.create(prompt=app.team.paid_media.public_skill()['workflows'][1]['prompt'])
        saved=json.loads(app.rows('SELECT team_snapshot FROM runs WHERE id=?',(r['id'],))[0]['team_snapshot'])
        plan={'category':'Paid ads budget review','diagnosis':'Check data before allocation proposals.',
              'tasks':[{'agent':'analytics','brief':'Check the report.'},{'agent':'growth','brief':'Budget pacing proposal.'}]}
        instructions=[]
        def provider(run_id,charter,payload,schema=None):
            instructions.append(charter)
            return [plan,'Data verdict: limited','Budget proposal','Final report'][len(instructions)-1]
        with patch.object(app.team.paid_media,'INSTRUCTIONS','Changed skill after queueing'),patch.object(app,'call_model',side_effect=provider):
            app.workflow(r['id'])
        self.assertEqual(len(instructions),4)
        self.assertIn(saved['specialists']['growth'],instructions[2])
        self.assertIn('PAID MEDIA OPS SKILL',instructions[2])
        self.assertNotIn('Changed skill after queueing',instructions[2])
        self.assertIn('PAID ADS DATA GATE',instructions[1])
        self.assertIn('Paid-ad review gate',instructions[3])
        self.assertEqual(app.run_detail(r['id'])['status'],'completed')

if __name__=='__main__': unittest.main()
